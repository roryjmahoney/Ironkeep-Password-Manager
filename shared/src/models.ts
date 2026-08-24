export const VAULT_FILE_FORMAT = "ironkeep-vault" as const;
export const VAULT_FILE_VERSION = 1 as const;
export const VAULT_SCHEMA_VERSION = 1 as const;

export type VaultItemKind = "login" | "secureNote" | "creditCard" | "identity";

export interface VaultItemBase {
  id: string;
  kind: VaultItemKind;
  title: string;
  categoryId?: string;
  tagIds: string[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface LoginItem extends VaultItemBase {
  kind: "login";
  username: string;
  password: string;
  uris: string[];
  androidPackageNames: string[];
  notes: string;
  totpSecret?: string;
}

export interface SecureNoteItem extends VaultItemBase {
  kind: "secureNote";
  body: string;
}

export interface CreditCardItem extends VaultItemBase {
  kind: "creditCard";
  cardholderName: string;
  number: string;
  expiryMonth: number;
  expiryYear: number;
  verificationCode: string;
  pin?: string;
  notes: string;
}

export interface IdentityItem extends VaultItemBase {
  kind: "identity";
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  notes: string;
}

export type VaultItem = LoginItem | SecureNoteItem | CreditCardItem | IdentityItem;

export interface VaultCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
}

export interface VaultTag {
  id: string;
  name: string;
}

export interface Tombstone {
  itemId: string;
  deletedAt: string;
  revision: number;
  deviceId: string;
}

export interface VaultSettings {
  autoLockMinutes: number;
  clearClipboardSeconds: number;
  theme: "system" | "light" | "dark";
  generator: PasswordGeneratorOptions;
}

export interface VaultPayload {
  schemaVersion: typeof VAULT_SCHEMA_VERSION;
  vaultId: string;
  name: string;
  revision: number;
  updatedAt: string;
  writerDeviceId: string;
  items: VaultItem[];
  categories: VaultCategory[];
  tags: VaultTag[];
  tombstones: Tombstone[];
  settings: VaultSettings;
}

export interface KdfParameters {
  algorithm: "argon2id";
  salt: string;
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

export interface EncryptedBlob {
  algorithm: "aes-256-gcm";
  nonce: string;
  ciphertext: string;
}

export interface VaultFile {
  format: typeof VAULT_FILE_FORMAT;
  fileVersion: typeof VAULT_FILE_VERSION;
  vaultId: string;
  revision: number;
  updatedAt: string;
  writerDeviceId: string;
  kdf: KdfParameters;
  keyWrap: EncryptedBlob;
  payload: EncryptedBlob;
}

export interface PasswordGeneratorOptions {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
  avoidRepeatingCharacters: boolean;
}

export const DEFAULT_GENERATOR_OPTIONS: PasswordGeneratorOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: true,
  avoidRepeatingCharacters: false,
};

export function createEmptyVault(name: string, deviceId: string, now = new Date()): VaultPayload {
  const timestamp = now.toISOString();
  return {
    schemaVersion: VAULT_SCHEMA_VERSION,
    vaultId: crypto.randomUUID(),
    name,
    revision: 1,
    updatedAt: timestamp,
    writerDeviceId: deviceId,
    items: [],
    categories: [
      { id: crypto.randomUUID(), name: "Personal", icon: "user", color: "brass" },
      { id: crypto.randomUUID(), name: "Work", icon: "briefcase", color: "slate" },
    ],
    tags: [],
    tombstones: [],
    settings: {
      autoLockMinutes: 5,
      clearClipboardSeconds: 30,
      theme: "system",
      generator: { ...DEFAULT_GENERATOR_OPTIONS },
    },
  };
}
