import {
  addLogin,
  createEmptyVault,
  createUnlockedVault,
  deleteLogin,
  editLogin,
  findLikelyLoginDuplicates,
  persistVaultMutation,
  toggleLoginFavorite,
  unlockVault,
  type LoginFields,
  type LoginItem,
  type UnlockedVault,
  type VaultFile,
  type VaultItem,
} from "@ironkeep/shared";
import browser from "webextension-polyfill";
import type { ExtensionRequest, ExtensionResponse, PublicLogin, PublicVaultItem } from "./types.js";

const STORAGE_KEY = "ironkeep.encryptedVault.v1";
const DEVICE_KEY = "ironkeep.deviceId";
let unlockedVault: UnlockedVault | null = null;

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

function publicItem(item: VaultItem): PublicVaultItem {
  let subtitle: string = item.kind;
  if (item.kind === "login") subtitle = item.username || item.uris[0] || "Login";
  if (item.kind === "creditCard") subtitle = item.number ? `•••• ${item.number.slice(-4)}` : "Payment card";
  if (item.kind === "identity") subtitle = item.email || "Identity";
  if (item.kind === "secureNote") subtitle = "Secure note";
  return { id: item.id, kind: item.kind, title: item.title, subtitle, favorite: item.favorite };
}

function publicLogin(item: LoginItem): PublicLogin {
  return {
    ...publicItem(item),
    kind: "login",
    username: item.username,
    password: item.password,
    uris: [...item.uris],
    androidPackageNames: [...item.androidPackageNames],
  };
}

function validLoginFields(fields: LoginFields): boolean {
  return typeof fields.title === "string" && typeof fields.username === "string" &&
    typeof fields.password === "string" && Array.isArray(fields.uris) && fields.uris.every((value) => typeof value === "string") &&
    Array.isArray(fields.androidPackageNames) && fields.androidPackageNames.every((value) => typeof value === "string");
}

async function persist(payload: UnlockedVault["payload"]): Promise<boolean> {
  if (!unlockedVault) return false;
  try {
    await persistVaultMutation(unlockedVault, payload, async (file) => {
      await browser.storage.local.set({ [STORAGE_KEY]: file });
    });
    return true;
  } catch {
    return false;
  }
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
  return unlockedVault.payload.items.filter((item): item is LoginItem =>
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
      const created = await createUnlockedVault(request.masterPassword, payload);
      try {
        await browser.storage.local.set({ [STORAGE_KEY]: created.file });
      } catch {
        created.session.close();
        return { ok: false, error: "PERSISTENCE_FAILED" };
      }
      unlockedVault?.close();
      unlockedVault = created.session;
      return { ok: true, status: "unlocked" };
    }
    case "UNLOCK": {
      const file = await storedFile();
      if (!file) return { ok: false, error: "NOT_FOUND" };
      try {
        const session = await unlockVault(request.masterPassword, file);
        unlockedVault?.close();
        unlockedVault = session;
        return { ok: true, status: "unlocked" };
      } catch {
        unlockedVault = null;
        return { ok: false, error: "AUTHENTICATION_FAILED" };
      }
    }
    case "LOCK":
      unlockedVault?.close();
      unlockedVault = null;
      return { ok: true, status: (await storedFile()) ? "locked" : "empty" };
    case "LIST_ITEMS":
      return unlockedVault
        ? { ok: true, items: unlockedVault.payload.items.map(publicItem) }
        : { ok: false, error: "LOCKED" };
    case "GET_LOGIN": {
      const item = unlockedVault?.payload.items.find((candidate): candidate is LoginItem => candidate.kind === "login" && candidate.id === request.itemId);
      return item ? { ok: true, item: publicLogin(item) } : { ok: false, error: unlockedVault ? "NOT_FOUND" : "LOCKED" };
    }
    case "CREATE_LOGIN": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      if (!validLoginFields(request.fields)) return { ok: false, error: "INVALID_REQUEST" };
      const duplicates = findLikelyLoginDuplicates(unlockedVault.payload, request.fields);
      if (duplicates.length && !request.confirmDuplicate) return { ok: false, error: "DUPLICATE", items: duplicates.map(publicItem) };
      try {
        const next = addLogin(unlockedVault.payload, request.fields, { deviceId: await deviceId() });
        if (!await persist(next)) return { ok: false, error: "PERSISTENCE_FAILED" };
        const item = next.items.at(-1);
        if (!item || item.kind !== "login") return { ok: false, error: "INVALID_REQUEST" };
        return { ok: true, item: publicLogin(item) };
      } catch {
        return { ok: false, error: "INVALID_REQUEST" };
      }
    }
    case "UPDATE_LOGIN": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      if (!validLoginFields(request.fields)) return { ok: false, error: "INVALID_REQUEST" };
      const duplicates = findLikelyLoginDuplicates(unlockedVault.payload, request.fields, request.itemId);
      if (duplicates.length && !request.confirmDuplicate) return { ok: false, error: "DUPLICATE", items: duplicates.map(publicItem) };
      try {
        const next = editLogin(unlockedVault.payload, request.itemId, request.fields, { deviceId: await deviceId() });
        if (!await persist(next)) return { ok: false, error: "PERSISTENCE_FAILED" };
        const item = next.items.find((candidate): candidate is LoginItem => candidate.kind === "login" && candidate.id === request.itemId);
        return item ? { ok: true, item: publicLogin(item) } : { ok: false, error: "NOT_FOUND" };
      } catch (error) {
        return { ok: false, error: error instanceof ReferenceError ? "NOT_FOUND" : "INVALID_REQUEST" };
      }
    }
    case "DELETE_LOGIN": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      if (!request.confirmed) return { ok: false, error: "INVALID_REQUEST" };
      try {
        const next = deleteLogin(unlockedVault.payload, request.itemId, { deviceId: await deviceId() });
        return await persist(next) ? { ok: true, status: "unlocked" } : { ok: false, error: "PERSISTENCE_FAILED" };
      } catch {
        return { ok: false, error: "NOT_FOUND" };
      }
    }
    case "TOGGLE_LOGIN_FAVORITE": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      try {
        const next = toggleLoginFavorite(unlockedVault.payload, request.itemId, { deviceId: await deviceId() });
        if (!await persist(next)) return { ok: false, error: "PERSISTENCE_FAILED" };
        const item = next.items.find((candidate): candidate is LoginItem => candidate.kind === "login" && candidate.id === request.itemId);
        return item ? { ok: true, item: publicLogin(item) } : { ok: false, error: "NOT_FOUND" };
      } catch {
        return { ok: false, error: "NOT_FOUND" };
      }
    }
    case "GET_MATCHES": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      const origin = await originForTab(request.tabId);
      return origin
        ? { ok: true, items: matchingLogins(origin).map(publicItem) }
        : { ok: false, error: "INVALID_REQUEST" };
    }
    case "FILL_ITEM": {
      const item = unlockedVault?.payload.items.find((candidate): candidate is LoginItem => candidate.kind === "login" && candidate.id === request.itemId);
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
