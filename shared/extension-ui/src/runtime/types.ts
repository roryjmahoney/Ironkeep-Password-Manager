import type { CapturedCredential, CreditCardFields, IdentityFields, LoginFields, SecureNoteFields, VaultItemKind } from "@ironkeep/shared";

export interface PublicVaultItem {
  id: string;
  kind: VaultItemKind;
  title: string;
  subtitle: string;
  favorite: boolean;
}

export interface PublicLogin extends PublicVaultItem, LoginFields {
  kind: "login";
}

export interface PublicSecureNote extends PublicVaultItem, SecureNoteFields {
  kind: "secureNote";
}

export interface PublicCreditCard extends PublicVaultItem, CreditCardFields {
  kind: "creditCard";
}

export interface PublicIdentity extends PublicVaultItem, IdentityFields {
  kind: "identity";
}

export interface PublicSecuritySettings {
  autoLockMinutes: number;
  clearClipboardSeconds: number;
}

export interface PublicCapturePrompt {
  id: string;
  origin: string;
  title: string;
  username: string;
  suggestedAction: "create" | "update" | "choose";
  suggestedItemId?: string;
  matches: PublicVaultItem[];
}

export type ContentRequest =
  | { type: "CAPTURE_CREDENTIAL"; credential: CapturedCredential }
  | { type: "GET_PENDING_CAPTURE" }
  | { type: "COMMIT_CAPTURE"; captureId: string; action: "create" | "update"; itemId?: string; confirmDuplicate: boolean }
  | { type: "DISMISS_CAPTURE"; captureId: string };

export type ContentResponse =
  | { ok: true; capture: PublicCapturePrompt | null }
  | { ok: true; captureStatus: "unchanged" | "dismissed" | "saved" }
  | { ok: false; error: "DUPLICATE"; items: PublicVaultItem[] }
  | { ok: false; error: "LOCKED" | "EXPIRED" | "INVALID_REQUEST" | "PERSISTENCE_FAILED" };

export type ExtensionRequest =
  | { type: "STATUS" }
  | { type: "CREATE_VAULT"; masterPassword: string }
  | { type: "UNLOCK"; masterPassword: string }
  | { type: "LOCK" }
  | { type: "TOUCH_SESSION" }
  | { type: "LIST_ITEMS" }
  | { type: "GET_LOGIN"; itemId: string }
  | { type: "CREATE_LOGIN"; fields: LoginFields; confirmDuplicate: boolean }
  | { type: "UPDATE_LOGIN"; itemId: string; fields: LoginFields; confirmDuplicate: boolean }
  | { type: "DELETE_LOGIN"; itemId: string; confirmed: boolean }
  | { type: "TOGGLE_LOGIN_FAVORITE"; itemId: string }
  | { type: "GET_SECURE_NOTE"; itemId: string }
  | { type: "CREATE_SECURE_NOTE"; fields: SecureNoteFields; confirmDuplicate: boolean }
  | { type: "UPDATE_SECURE_NOTE"; itemId: string; fields: SecureNoteFields; confirmDuplicate: boolean }
  | { type: "DELETE_SECURE_NOTE"; itemId: string; confirmed: boolean }
  | { type: "TOGGLE_SECURE_NOTE_FAVORITE"; itemId: string }
  | { type: "GET_CREDIT_CARD"; itemId: string }
  | { type: "CREATE_CREDIT_CARD"; fields: CreditCardFields; confirmDuplicate: boolean }
  | { type: "UPDATE_CREDIT_CARD"; itemId: string; fields: CreditCardFields; confirmDuplicate: boolean }
  | { type: "DELETE_CREDIT_CARD"; itemId: string; confirmed: boolean }
  | { type: "TOGGLE_CREDIT_CARD_FAVORITE"; itemId: string }
  | { type: "GET_IDENTITY"; itemId: string }
  | { type: "CREATE_IDENTITY"; fields: IdentityFields; confirmDuplicate: boolean }
  | { type: "UPDATE_IDENTITY"; itemId: string; fields: IdentityFields; confirmDuplicate: boolean }
  | { type: "DELETE_IDENTITY"; itemId: string; confirmed: boolean }
  | { type: "TOGGLE_IDENTITY_FAVORITE"; itemId: string }
  | { type: "GET_MATCHES"; tabId: number }
  | { type: "FILL_ITEM"; itemId: string; tabId: number }
  | { type: "GET_SECURITY_SETTINGS" }
  | { type: "UPDATE_SECURITY_SETTINGS"; settings: PublicSecuritySettings }
  | { type: "COPY_SECRET"; value: string };

export type ExtensionResponse =
  | { ok: true; status: "empty" | "locked" | "unlocked" }
  | { ok: true; items: PublicVaultItem[] }
  | { ok: true; item: PublicLogin }
  | { ok: true; item: PublicSecureNote }
  | { ok: true; item: PublicCreditCard }
  | { ok: true; item: PublicIdentity }
  | { ok: true; settings: PublicSecuritySettings }
  | { ok: true; copied: true; clearAfterSeconds: number }
  | { ok: false; error: "DUPLICATE"; items: PublicVaultItem[] }
  | { ok: false; error: "AUTHENTICATION_FAILED" | "LOCKED" | "NOT_FOUND" | "INVALID_REQUEST" | "PERSISTENCE_FAILED" };
