import type { VaultItemKind } from "@ironkeep/shared";

export interface PublicVaultItem {
  id: string;
  kind: VaultItemKind;
  title: string;
  subtitle: string;
  favorite: boolean;
}

export type ExtensionRequest =
  | { type: "STATUS" }
  | { type: "CREATE_VAULT"; masterPassword: string }
  | { type: "UNLOCK"; masterPassword: string }
  | { type: "LOCK" }
  | { type: "LIST_ITEMS" }
  | { type: "GET_MATCHES"; tabId: number }
  | { type: "FILL_ITEM"; itemId: string; tabId: number };

export type ExtensionResponse =
  | { ok: true; status: "empty" | "locked" | "unlocked" }
  | { ok: true; items: PublicVaultItem[] }
  | { ok: false; error: "AUTHENTICATION_FAILED" | "LOCKED" | "NOT_FOUND" | "INVALID_REQUEST" };
