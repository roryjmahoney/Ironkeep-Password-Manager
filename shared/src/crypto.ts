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

export interface EncryptPayloadOptions {
  payloadNonce?: Uint8Array;
}

export interface ChangeMasterPasswordOptions {
  kdf?: Omit<KdfParameters, "algorithm" | "salt">;
  salt?: Uint8Array;
  keyWrapNonce?: Uint8Array;
  payloadNonce?: Uint8Array;
}

export interface EncryptedVaultSession {
  file: VaultFile;
  session: UnlockedVault;
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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

function assertPayloadMetadata(payload: VaultPayload): void {
  if (
    payload.schemaVersion !== VAULT_SCHEMA_VERSION ||
    !Number.isSafeInteger(payload.revision) ||
    payload.revision < 1 ||
    payload.vaultId.length < 1 ||
    payload.vaultId.length > 128 ||
    payload.writerDeviceId.length < 1 ||
    payload.writerDeviceId.length > 128
  ) {
    throw new TypeError("Unsupported vault payload");
  }
}

export class UnlockedVault {
  #dataKey: Uint8Array;
  #file: VaultFile;
  #closed = false;
  payload: VaultPayload;

  constructor(payload: VaultPayload, dataKey: Uint8Array, file: VaultFile) {
    this.payload = payload;
    this.#dataKey = dataKey;
    this.#file = file;
  }

  async encryptPayload(payload: VaultPayload, options: EncryptPayloadOptions = {}): Promise<VaultFile> {
    if (this.#closed) throw new Error("Vault session is locked");
    assertPayloadMetadata(payload);
    if (payload.vaultId !== this.#file.vaultId) throw new TypeError("Vault identifier cannot change");

    const previousNonce = base64UrlToBytes(this.#file.payload.nonce);
    const payloadNonce = options.payloadNonce?.slice() ?? randomBytes(AES_GCM_NONCE_BYTES);
    if (payloadNonce.length !== AES_GCM_NONCE_BYTES || sameBytes(payloadNonce, previousNonce)) {
      payloadNonce.fill(0);
      previousNonce.fill(0);
      throw new RangeError("Payload nonce must be fresh and 12 bytes long");
    }
    previousNonce.fill(0);

    const withoutPayload = {
      format: this.#file.format,
      fileVersion: this.#file.fileVersion,
      vaultId: payload.vaultId,
      revision: payload.revision,
      updatedAt: payload.updatedAt,
      writerDeviceId: payload.writerDeviceId,
      kdf: this.#file.kdf,
      keyWrap: this.#file.keyWrap,
    };
    const plaintext = encoder.encode(JSON.stringify(payload));
    try {
      const encryptedPayload = await aesEncrypt(this.#dataKey, plaintext, payloadNonce, payloadAad(withoutPayload));
      return { ...withoutPayload, payload: encryptedBlob(payloadNonce, encryptedPayload) };
    } finally {
      plaintext.fill(0);
      payloadNonce.fill(0);
    }
  }

  async changeMasterPassword(
    currentMasterPassword: string,
    newMasterPassword: string,
    options: ChangeMasterPasswordOptions = {},
  ): Promise<VaultFile> {
    if (this.#closed) throw new Error("Vault session is locked");
    if (newMasterPassword.length < 12) throw new RangeError("Master password must be at least 12 characters");

    let currentKeyEncryptionKey: Uint8Array | undefined;
    let verifiedDataKey: Uint8Array | undefined;
    let newKeyEncryptionKey: Uint8Array | undefined;
    const requestedKdf = options.kdf ?? DEFAULT_KDF_PARAMETERS;
    validateKdf(requestedKdf);
    const salt = options.salt?.slice() ?? randomBytes(ARGON2_SALT_BYTES);
    const keyWrapNonce = options.keyWrapNonce?.slice() ?? randomBytes(AES_GCM_NONCE_BYTES);
    const payloadNonce = options.payloadNonce?.slice() ?? randomBytes(AES_GCM_NONCE_BYTES);
    if (salt.length !== ARGON2_SALT_BYTES || keyWrapNonce.length !== AES_GCM_NONCE_BYTES || payloadNonce.length !== AES_GCM_NONCE_BYTES) {
      salt.fill(0);
      keyWrapNonce.fill(0);
      payloadNonce.fill(0);
      throw new RangeError("Invalid cryptographic material length");
    }

    try {
      currentKeyEncryptionKey = await deriveKeyEncryptionKey(currentMasterPassword, this.#file.kdf);
      verifiedDataKey = await aesDecrypt(
        currentKeyEncryptionKey,
        base64UrlToBytes(this.#file.keyWrap.ciphertext),
        base64UrlToBytes(this.#file.keyWrap.nonce),
        keyWrapAad(this.#file),
      );
      if (!sameBytes(verifiedDataKey, this.#dataKey)) throw new VaultAuthenticationError();

      const kdf: KdfParameters = { algorithm: "argon2id", salt: bytesToBase64Url(salt), ...requestedKdf };
      const header = {
        format: this.#file.format,
        fileVersion: this.#file.fileVersion,
        vaultId: this.#file.vaultId,
        revision: this.#file.revision,
        updatedAt: this.#file.updatedAt,
        writerDeviceId: this.#file.writerDeviceId,
        kdf,
      } as const;
      newKeyEncryptionKey = await deriveKeyEncryptionKey(newMasterPassword, kdf);
      const wrappedKey = await aesEncrypt(newKeyEncryptionKey, this.#dataKey, keyWrapNonce, keyWrapAad(header));
      const keyWrap = encryptedBlob(keyWrapNonce, wrappedKey);
      const withoutPayload = { ...header, keyWrap };
      const plaintext = encoder.encode(JSON.stringify(this.payload));
      try {
        const encryptedPayload = await aesEncrypt(this.#dataKey, plaintext, payloadNonce, payloadAad(withoutPayload));
        return { ...withoutPayload, payload: encryptedBlob(payloadNonce, encryptedPayload) };
      } finally {
        plaintext.fill(0);
      }
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError || error instanceof VaultAuthenticationError) throw error;
      throw new VaultAuthenticationError();
    } finally {
      currentKeyEncryptionKey?.fill(0);
      verifiedDataKey?.fill(0);
      newKeyEncryptionKey?.fill(0);
      salt.fill(0);
      keyWrapNonce.fill(0);
      payloadNonce.fill(0);
    }
  }

  commit(file: VaultFile, payload: VaultPayload): void {
    if (this.#closed) throw new Error("Vault session is locked");
    assertEnvelope(file);
    if (
      payload.vaultId !== file.vaultId ||
      payload.revision !== file.revision ||
      payload.updatedAt !== file.updatedAt ||
      payload.writerDeviceId !== file.writerDeviceId ||
      file.kdf.algorithm !== this.#file.kdf.algorithm ||
      file.kdf.salt !== this.#file.kdf.salt ||
      file.kdf.memoryKiB !== this.#file.kdf.memoryKiB ||
      file.kdf.iterations !== this.#file.kdf.iterations ||
      file.kdf.parallelism !== this.#file.kdf.parallelism ||
      file.keyWrap.nonce !== this.#file.keyWrap.nonce ||
      file.keyWrap.ciphertext !== this.#file.keyWrap.ciphertext
    ) {
      throw new TypeError("Committed vault metadata does not match");
    }
    this.#file = file;
    this.payload = payload;
  }

  commitMasterPasswordChange(file: VaultFile): void {
    if (this.#closed) throw new Error("Vault session is locked");
    assertEnvelope(file);
    if (
      file.vaultId !== this.payload.vaultId ||
      file.revision !== this.payload.revision ||
      file.updatedAt !== this.payload.updatedAt ||
      file.writerDeviceId !== this.payload.writerDeviceId
    ) {
      throw new TypeError("Password-change vault metadata does not match");
    }
    this.#file = file;
  }

  close(): void {
    if (this.#closed) return;
    this.#dataKey.fill(0);
    this.#closed = true;
  }
}

export async function createUnlockedVault(
  masterPassword: string,
  payload: VaultPayload,
  options: CreateVaultOptions = {},
): Promise<EncryptedVaultSession> {
  assertPayloadMetadata(payload);

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
      const file = { ...withoutPayload, payload: encryptedBlob(vaultNonce, encryptedPayload) };
      return { file, session: new UnlockedVault(payload, dataKey.slice(), file) };
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

export async function encryptVault(
  masterPassword: string,
  payload: VaultPayload,
  options: CreateVaultOptions = {},
): Promise<VaultFile> {
  const result = await createUnlockedVault(masterPassword, payload, options);
  result.session.close();
  return result.file;
}

export async function unlockVault(masterPassword: string, file: VaultFile): Promise<UnlockedVault> {
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
    const session = new UnlockedVault(payload, dataKey, file);
    dataKey = undefined;
    return session;
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

export async function decryptVault(masterPassword: string, file: VaultFile): Promise<VaultPayload> {
  const session = await unlockVault(masterPassword, file);
  try {
    return session.payload;
  } finally {
    session.close();
  }
}

export async function persistVaultMutation(
  session: UnlockedVault,
  payload: VaultPayload,
  write: (file: VaultFile) => Promise<void>,
): Promise<VaultFile> {
  const file = await session.encryptPayload(payload);
  await write(file);
  session.commit(file, payload);
  return file;
}

export async function persistMasterPasswordChange(
  session: UnlockedVault,
  currentMasterPassword: string,
  newMasterPassword: string,
  write: (file: VaultFile) => Promise<void>,
  options: ChangeMasterPasswordOptions = {},
): Promise<VaultFile> {
  const file = await session.changeMasterPassword(currentMasterPassword, newMasterPassword, options);
  await write(file);
  session.commitMasterPasswordChange(file);
  return file;
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
