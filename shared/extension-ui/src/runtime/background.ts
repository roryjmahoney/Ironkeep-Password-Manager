import { createEmptyVault, decryptVault, encryptVault, type LoginItem, type VaultFile, type VaultPayload } from "@ironkeep/shared";
import browser from "webextension-polyfill";
import type { ExtensionRequest, ExtensionResponse, PublicVaultItem } from "./types.js";

const STORAGE_KEY = "ironkeep.encryptedVault.v1";
const DEVICE_KEY = "ironkeep.deviceId";
let unlockedVault: VaultPayload | null = null;

async function storedFile(): Promise<VaultFile | null> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as VaultFile | undefined) ?? null;
}

async function deviceId(): Promise<string> {
  const result = await browser.storage.local.get(DEVICE_KEY);
  const existing = result[DEVICE_KEY];
  if (typeof existing === "string") return existing;
  const created = crypto.randomUUID();
  await browser.storage.local.set({ [DEVICE_KEY]: created });
  return created;
}

function publicItem(item: VaultPayload["items"][number]): PublicVaultItem {
  let subtitle: string = item.kind;
  if (item.kind === "login") subtitle = item.username || item.uris[0] || "Login";
  if (item.kind === "creditCard") subtitle = item.number ? `•••• ${item.number.slice(-4)}` : "Payment card";
  if (item.kind === "identity") subtitle = item.email || "Identity";
  if (item.kind === "secureNote") subtitle = "Secure note";
  return { id: item.id, kind: item.kind, title: item.title, subtitle, favorite: item.favorite };
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin.toLowerCase() : null;
  } catch {
    return null;
  }
}

function matchingLogins(origin: string): LoginItem[] {
  const normalized = normalizeOrigin(origin);
  if (!normalized || !unlockedVault) return [];
  return unlockedVault.items.filter((item): item is LoginItem =>
    item.kind === "login" && item.uris.some((uri) => normalizeOrigin(uri) === normalized),
  );
}

async function originForTab(tabId: number): Promise<string | null> {
  const tab = await browser.tabs.get(tabId);
  return tab.url ? normalizeOrigin(tab.url) : null;
}

async function handleRequest(request: ExtensionRequest): Promise<ExtensionResponse> {
  switch (request.type) {
    case "STATUS": {
      if (unlockedVault) return { ok: true, status: "unlocked" };
      return { ok: true, status: (await storedFile()) ? "locked" : "empty" };
    }
    case "CREATE_VAULT": {
      if (request.masterPassword.length < 12) return { ok: false, error: "INVALID_REQUEST" };
      if (await storedFile()) return { ok: false, error: "INVALID_REQUEST" };
      const payload = createEmptyVault("My Keep", await deviceId());
      const file = await encryptVault(request.masterPassword, payload);
      await browser.storage.local.set({ [STORAGE_KEY]: file });
      unlockedVault = payload;
      return { ok: true, status: "unlocked" };
    }
    case "UNLOCK": {
      const file = await storedFile();
      if (!file) return { ok: false, error: "NOT_FOUND" };
      try {
        unlockedVault = await decryptVault(request.masterPassword, file);
        return { ok: true, status: "unlocked" };
      } catch {
        unlockedVault = null;
        return { ok: false, error: "AUTHENTICATION_FAILED" };
      }
    }
    case "LOCK":
      unlockedVault = null;
      return { ok: true, status: (await storedFile()) ? "locked" : "empty" };
    case "LIST_ITEMS":
      return unlockedVault
        ? { ok: true, items: unlockedVault.items.map(publicItem) }
        : { ok: false, error: "LOCKED" };
    case "GET_MATCHES": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      const origin = await originForTab(request.tabId);
      return origin
        ? { ok: true, items: matchingLogins(origin).map(publicItem) }
        : { ok: false, error: "INVALID_REQUEST" };
    }
    case "FILL_ITEM": {
      const item = unlockedVault?.items.find((candidate): candidate is LoginItem => candidate.kind === "login" && candidate.id === request.itemId);
      if (!item) return { ok: false, error: unlockedVault ? "NOT_FOUND" : "LOCKED" };
      const tabOrigin = await originForTab(request.tabId);
      if (!tabOrigin || !item.uris.some((uri) => normalizeOrigin(uri) === tabOrigin)) {
        return { ok: false, error: "INVALID_REQUEST" };
      }
      await browser.tabs.sendMessage(request.tabId, {
        type: "IRONKEEP_FILL",
        username: item.username,
        password: item.password,
      }, { frameId: 0 });
      return { ok: true, status: "unlocked" };
    }
  }
}

export function installBackground(): void {
  browser.runtime.onMessage.addListener((rawRequest: unknown) => {
    if (!rawRequest || typeof rawRequest !== "object" || !("type" in rawRequest)) {
      return Promise.resolve({ ok: false, error: "INVALID_REQUEST" } satisfies ExtensionResponse);
    }
    return handleRequest(rawRequest as ExtensionRequest);
  });
}
