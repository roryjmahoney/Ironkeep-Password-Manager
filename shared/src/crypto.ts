import { argon2id } from "hash-wasm";
import {
  VAULT_FILE_FORMAT,
  VAULT_FILE_VERSION,
  VAULT_SCHEMA_VERSION,
  type EncryptedBlob,
  type KdfParameters,
  type VaultFile,
  type VaultPayload,
} from "./models.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const AES_KEY_BYTES = 32;
const AES_GCM_NONCE_BYTES = 12;
const ARGON2_SALT_BYTES = 16;
const MAX_VAULT_FILE_BYTES = 64 * 1024 * 1024;

export const MINIMUM_KDF_PARAMETERS = {
  memoryKiB: 19 * 1024,
  iterations: 2,
  parallelism: 1,
} as const;

export const DEFAULT_KDF_PARAMETERS = {
  memoryKiB: 64 * 1024,
  iterations: 3,
  parallelism: 4,
} as const;

export const MAXIMUM_KDF_PARAMETERS = {
  memoryKiB: 256 * 1024,
  iterations: 10,
  parallelism: 8,
} as const;

export class VaultAuthenticationError extends Error {
  constructor() {
    super("Vault authentication failed");
    this.name = "VaultAuthenticationError";
  }
}

export interface CreateVaultOptions {
  kdf?: Omit<KdfParameters, "algorithm" | "salt">;
  salt?: Uint8Array;
  dataKey?: Uint8Array;
  keyWrapNonce?: Uint8Array;
  payloadNonce?: Uint8Array;
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new TypeError("Invalid base64url value");
  }
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function validateKdf(parameters: Omit<KdfParameters, "algorithm" | "salt">): void {
  if (
    !Number.isSafeInteger(parameters.memoryKiB) ||
    !Number.isSafeInteger(parameters.iterations) ||
    !Number.isSafeInteger(parameters.parallelism) ||
    parameters.memoryKiB < MINIMUM_KDF_PARAMETERS.memoryKiB ||
    parameters.iterations < MINIMUM_KDF_PARAMETERS.iterations ||
    parameters.parallelism < MINIMUM_KDF_PARAMETERS.parallelism ||
    parameters.memoryKiB > MAXIMUM_KDF_PARAMETERS.memoryKiB ||
    parameters.iterations > MAXIMUM_KDF_PARAMETERS.iterations ||
    parameters.parallelism > MAXIMUM_KDF_PARAMETERS.parallelism
  ) {
    throw new RangeError("Argon2id parameters are below Ironkeep's security floor");
  }
}

async function deriveKeyEncryptionKey(masterPassword: string, kdf: KdfParameters): Promise<Uint8Array> {
  validateKdf(kdf);
  const passwordBytes = encoder.encode(masterPassword);
  if (passwordBytes.length === 0) {
    throw new RangeError("Master password must not be empty");
  }

  try {
    const result = await argon2id({
      password: passwordBytes,
      salt: base64UrlToBytes(kdf.salt),
      iterations: kdf.iterations,
      parallelism: kdf.parallelism,
      memorySize: kdf.memoryKiB,
      hashLength: AES_KEY_BYTES,
      outputType: "binary",
    });
    return result as Uint8Array;
  } finally {
    passwordBytes.fill(0);
  }
}

function keyWrapAad(file: Pick<VaultFile, "format" | "fileVersion" | "vaultId" | "kdf">): Uint8Array {
  return encoder.encode(JSON.stringify([
    "IronkeepKeyWrap",
    file.format,
    file.fileVersion,
    file.vaultId,
    file.kdf.algorithm,
    file.kdf.salt,
    file.kdf.memoryKiB,
    file.kdf.iterations,
    file.kdf.parallelism,
  ]));
}

function payloadAad(file: Omit<VaultFile, "payload">): Uint8Array {
  return encoder.encode(JSON.stringify([
    "IronkeepPayload",
    file.format,
    file.fileVersion,
    file.vaultId,
    file.revision,
    file.updatedAt,
    file.writerDeviceId,
    file.keyWrap.algorithm,
    file.keyWrap.nonce,
    file.keyWrap.ciphertext,
  ]));
}

async function aesEncrypt(
  keyBytes: Uint8Array,
  plaintext: Uint8Array,
  nonce: Uint8Array,
  additionalData: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), "AES-GCM", false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(nonce), additionalData: toArrayBuffer(additionalData), tagLength: 128 },
    key,
    toArrayBuffer(plaintext),
  );
  return new Uint8Array(encrypted);
}

async function aesDecrypt(
  keyBytes: Uint8Array,
  encrypted: Uint8Array,
  nonce: Uint8Array,
  additionalData: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(nonce), additionalData: toArrayBuffer(additionalData), tagLength: 128 },
    key,
    toArrayBuffer(encrypted),
  );
  return new Uint8Array(plaintext);
}

function encryptedBlob(nonce: Uint8Array, ciphertext: Uint8Array): EncryptedBlob {
  return {
    algorithm: "aes-256-gcm",
    nonce: bytesToBase64Url(nonce),
    ciphertext: bytesToBase64Url(ciphertext),
  };
}

function assertEnvelope(file: VaultFile): void {
  if (
    file.format !== VAULT_FILE_FORMAT ||
    file.fileVersion !== VAULT_FILE_VERSION ||
    file.kdf.algorithm !== "argon2id" ||
    file.keyWrap.algorithm !== "aes-256-gcm" ||
    file.payload.algorithm !== "aes-256-gcm" ||
    !Number.isSafeInteger(file.revision) ||
    file.revision < 1 ||
    file.vaultId.length < 1 ||
    file.vaultId.length > 128 ||
    file.writerDeviceId.length < 1 ||
    file.writerDeviceId.length > 128
  ) {
    throw new TypeError("Unsupported or malformed Ironkeep vault envelope");
  }
  validateKdf(file.kdf);
  if (
    base64UrlToBytes(file.kdf.salt).length !== ARGON2_SALT_BYTES ||
    base64UrlToBytes(file.keyWrap.nonce).length !== AES_GCM_NONCE_BYTES ||
    base64UrlToBytes(file.payload.nonce).length !== AES_GCM_NONCE_BYTES ||
    base64UrlToBytes(file.keyWrap.ciphertext).length !== AES_KEY_BYTES + 16 ||
    base64UrlToBytes(file.payload.ciphertext).length < 16
  ) {
    throw new TypeError("Malformed Ironkeep cryptographic parameters");
  }
}

export async function encryptVault(
  masterPassword: string,
  payload: VaultPayload,
  options: CreateVaultOptions = {},
): Promise<VaultFile> {
  if (payload.schemaVersion !== VAULT_SCHEMA_VERSION || payload.revision < 1) {
    throw new TypeError("Unsupported vault payload");
  }

  const requestedKdf = options.kdf ?? DEFAULT_KDF_PARAMETERS;
  validateKdf(requestedKdf);
  const salt = options.salt?.slice() ?? randomBytes(ARGON2_SALT_BYTES);
  const dataKey = options.dataKey?.slice() ?? randomBytes(AES_KEY_BYTES);
  const wrapNonce = options.keyWrapNonce?.slice() ?? randomBytes(AES_GCM_NONCE_BYTES);
  const vaultNonce = options.payloadNonce?.slice() ?? randomBytes(AES_GCM_NONCE_BYTES);
  if (
    salt.length !== ARGON2_SALT_BYTES ||
    dataKey.length !== AES_KEY_BYTES ||
    wrapNonce.length !== AES_GCM_NONCE_BYTES ||
    vaultNonce.length !== AES_GCM_NONCE_BYTES
  ) {
    throw new RangeError("Invalid cryptographic material length");
  }

  const kdf: KdfParameters = {
    algorithm: "argon2id",
    salt: bytesToBase64Url(salt),
    ...requestedKdf,
  };
  const header = {
    format: VAULT_FILE_FORMAT,
    fileVersion: VAULT_FILE_VERSION,
    vaultId: payload.vaultId,
    revision: payload.revision,
    updatedAt: payload.updatedAt,
    writerDeviceId: payload.writerDeviceId,
    kdf,
  } as const;

  let keyEncryptionKey: Uint8Array | undefined;
  try {
    keyEncryptionKey = await deriveKeyEncryptionKey(masterPassword, kdf);
    const wrappedKeyBytes = await aesEncrypt(keyEncryptionKey, dataKey, wrapNonce, keyWrapAad(header));
    const keyWrap = encryptedBlob(wrapNonce, wrappedKeyBytes);
    const withoutPayload = { ...header, keyWrap };
    const plaintext = encoder.encode(JSON.stringify(payload));
    try {
      const encryptedPayload = await aesEncrypt(dataKey, plaintext, vaultNonce, payloadAad(withoutPayload));
      return { ...withoutPayload, payload: encryptedBlob(vaultNonce, encryptedPayload) };
    } finally {
      plaintext.fill(0);
    }
  } finally {
    keyEncryptionKey?.fill(0);
    dataKey.fill(0);
    salt.fill(0);
    wrapNonce.fill(0);
    vaultNonce.fill(0);
  }
}

export async function decryptVault(masterPassword: string, file: VaultFile): Promise<VaultPayload> {
  assertEnvelope(file);
  let keyEncryptionKey: Uint8Array | undefined;
  let dataKey: Uint8Array | undefined;
  let plaintext: Uint8Array | undefined;
  try {
    keyEncryptionKey = await deriveKeyEncryptionKey(masterPassword, file.kdf);
    dataKey = await aesDecrypt(
      keyEncryptionKey,
      base64UrlToBytes(file.keyWrap.ciphertext),
      base64UrlToBytes(file.keyWrap.nonce),
      keyWrapAad(file),
    );
    if (dataKey.length !== AES_KEY_BYTES) {
      throw new VaultAuthenticationError();
    }
    plaintext = await aesDecrypt(
      dataKey,
      base64UrlToBytes(file.payload.ciphertext),
      base64UrlToBytes(file.payload.nonce),
      payloadAad(file),
    );
    const payload = JSON.parse(decoder.decode(plaintext)) as VaultPayload;
    if (
      payload.schemaVersion !== VAULT_SCHEMA_VERSION ||
      payload.vaultId !== file.vaultId ||
      payload.revision !== file.revision ||
      payload.updatedAt !== file.updatedAt ||
      payload.writerDeviceId !== file.writerDeviceId ||
      !Array.isArray(payload.items) ||
      !Array.isArray(payload.tombstones)
    ) {
      throw new VaultAuthenticationError();
    }
    return payload;
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      throw error;
    }
    throw new VaultAuthenticationError();
  } finally {
    keyEncryptionKey?.fill(0);
    dataKey?.fill(0);
    plaintext?.fill(0);
  }
}

export function serializeVaultFile(file: VaultFile): Uint8Array {
  assertEnvelope(file);
  return encoder.encode(JSON.stringify(file));
}

export function parseVaultFile(bytes: Uint8Array): VaultFile {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_VAULT_FILE_BYTES) {
    throw new RangeError("Vault file size is invalid");
  }
  const file = JSON.parse(decoder.decode(bytes)) as VaultFile;
  assertEnvelope(file);
  return file;
}
