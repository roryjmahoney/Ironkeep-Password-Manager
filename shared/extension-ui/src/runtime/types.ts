import type { LoginFields, VaultItemKind } from "@ironkeep/shared";

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

export type ExtensionRequest =
  | { type: "STATUS" }
  | { type: "CREATE_VAULT"; masterPassword: string }
  | { type: "UNLOCK"; masterPassword: string }
  | { type: "LOCK" }
  | { type: "LIST_ITEMS" }
  | { type: "GET_LOGIN"; itemId: string }
  | { type: "CREATE_LOGIN"; fields: LoginFields; confirmDuplicate: boolean }
  | { type: "UPDATE_LOGIN"; itemId: string; fields: LoginFields; confirmDuplicate: boolean }
  | { type: "DELETE_LOGIN"; itemId: string; confirmed: boolean }
  | { type: "TOGGLE_LOGIN_FAVORITE"; itemId: string }
  | { type: "GET_MATCHES"; tabId: number }
  | { type: "FILL_ITEM"; itemId: string; tabId: number };

export type ExtensionResponse =
  | { ok: true; status: "empty" | "locked" | "unlocked" }
  | { ok: true; items: PublicVaultItem[] }
  | { ok: true; item: PublicLogin }
  | { ok: false; error: "DUPLICATE"; items: PublicVaultItem[] }
  | { ok: false; error: "AUTHENTICATION_FAILED" | "LOCKED" | "NOT_FOUND" | "INVALID_REQUEST" | "PERSISTENCE_FAILED" };
