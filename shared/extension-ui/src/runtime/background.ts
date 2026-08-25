import {
  addLogin,
  createEmptyVault,
  createUnlockedVault,
  deleteLogin,
  editLogin,
  EphemeralCaptureStore,
  exactOriginLogins,
  findLikelyLoginDuplicates,
  loginFieldsForCapture,
  persistVaultMutation,
  SessionDeadline,
  shouldClearClipboard,
  suggestCredentialCapture,
  titleForOrigin,
  toggleLoginFavorite,
  unlockVault,
  updateSecuritySettings,
  validCapturedCredential,
  type LoginFields,
  type LoginItem,
  type PendingCredentialCapture,
  type UnlockedVault,
  type VaultFile,
  type VaultItem,
} from "@ironkeep/shared";
import browser from "webextension-polyfill";
import type { ContentRequest, ContentResponse, ExtensionRequest, ExtensionResponse, PublicCapturePrompt, PublicLogin, PublicVaultItem } from "./types.js";

const STORAGE_KEY = "ironkeep.encryptedVault.v1";
const DEVICE_KEY = "ironkeep.deviceId";
let unlockedVault: UnlockedVault | null = null;
const sessionDeadline = new SessionDeadline();
const sessionNow = (): number => performance.now();
let sessionLockTimer: ReturnType<typeof setTimeout> | null = null;
let clipboardTimer: ReturnType<typeof setTimeout> | null = null;
let clipboardExpected: string | null = null;
interface RuntimeSender {
  tab?: { id?: number };
  frameId?: number;
  url?: string;
}
const pendingCaptures = new EphemeralCaptureStore();

interface OffscreenApi {
  hasDocument?: () => Promise<boolean>;
  createDocument(options: { url: string; reasons: string[]; justification: string }): Promise<void>;
  closeDocument(): Promise<void>;
}

function offscreenApi(): OffscreenApi | null {
  return (globalThis as { chrome?: { offscreen?: OffscreenApi } }).chrome?.offscreen ?? null;
}

function clearSessionTimer(): void {
  if (sessionLockTimer !== null) clearTimeout(sessionLockTimer);
  sessionLockTimer = null;
}

function scheduleSessionLock(): void {
  clearSessionTimer();
  if (!unlockedVault) return;
  const remaining = sessionDeadline.remainingMs(sessionNow(), unlockedVault.payload.settings.autoLockMinutes);
  if (remaining === null) return;
  sessionLockTimer = setTimeout(() => {
    sessionLockTimer = null;
    enforceSessionDeadline();
  }, remaining);
}

function enforceSessionDeadline(): void {
  if (!unlockedVault) return;
  if (sessionDeadline.expiryReason(sessionNow(), unlockedVault.payload.settings.autoLockMinutes)) lockVault();
  else scheduleSessionLock();
}

function touchSession(): void {
  if (!unlockedVault) return;
  sessionDeadline.touch(sessionNow());
  scheduleSessionLock();
}

function openSession(session: UnlockedVault): void {
  unlockedVault?.close();
  unlockedVault = session;
  sessionDeadline.open(sessionNow());
  browser.idle.setDetectionInterval(session.payload.settings.autoLockMinutes * 60);
  scheduleSessionLock();
}

function lockVault(): void {
  clearSessionTimer();
  sessionDeadline.close();
  unlockedVault?.close();
  unlockedVault = null;
  pendingCaptures.clear();
  void clearOwnedClipboard();
}

async function ensureOffscreenClipboard(): Promise<OffscreenApi> {
  const offscreen = offscreenApi();
  if (!offscreen) throw new Error("Offscreen clipboard is unavailable");
  const exists = offscreen.hasDocument ? await offscreen.hasDocument() : false;
  if (!exists) {
    await offscreen.createDocument({
      url: "clipboard.html",
      reasons: ["CLIPBOARD"],
      justification: "Write and clear an Ironkeep-owned password without overwriting newer clipboard content.",
    });
  }
  return offscreen;
}

async function copySecret(value: string, clearAfterSeconds: number): Promise<boolean> {
  if (!value) return false;
  if (offscreenApi()) {
    await ensureOffscreenClipboard();
    const response = await browser.runtime.sendMessage({ type: "IRONKEEP_CLIPBOARD_WRITE", value, clearAfterSeconds }) as { ok?: boolean } | undefined;
    return response?.ok === true;
  }
  if (!navigator.clipboard) return false;
  await navigator.clipboard.writeText(value);
  if (clipboardTimer !== null) clearTimeout(clipboardTimer);
  clipboardExpected = value;
  clipboardTimer = setTimeout(() => { void clearOwnedClipboard(); }, clearAfterSeconds * 1_000);
  return true;
}

async function clearOwnedClipboard(): Promise<void> {
  if (offscreenApi()) {
    await ensureOffscreenClipboard().then(() => browser.runtime.sendMessage({ type: "IRONKEEP_CLIPBOARD_CLEAR_NOW" })).catch(() => undefined);
    return;
  }
  if (clipboardTimer !== null) clearTimeout(clipboardTimer);
  clipboardTimer = null;
  const expected = clipboardExpected;
  clipboardExpected = null;
  if (!expected || !navigator.clipboard) return;
  try {
    const current = await navigator.clipboard.readText();
    if (shouldClearClipboard(expected, current)) await navigator.clipboard.writeText("");
  } catch {
    // Clipboard clearing is best effort when the browser denies background access.
  }
}

function requestTouchesSession(type: ExtensionRequest["type"]): boolean {
  return type !== "STATUS" && type !== "LOCK";
}

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
  enforceSessionDeadline();
  if (unlockedVault && requestTouchesSession(request.type)) touchSession();
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
      openSession(created.session);
      return { ok: true, status: "unlocked" };
    }
    case "UNLOCK": {
      const file = await storedFile();
      if (!file) return { ok: false, error: "NOT_FOUND" };
      try {
        const session = await unlockVault(request.masterPassword, file);
        openSession(session);
        return { ok: true, status: "unlocked" };
      } catch {
        lockVault();
        return { ok: false, error: "AUTHENTICATION_FAILED" };
      }
    }
    case "LOCK":
      lockVault();
      return { ok: true, status: (await storedFile()) ? "locked" : "empty" };
    case "TOUCH_SESSION":
      return unlockedVault ? { ok: true, status: "unlocked" } : { ok: false, error: "LOCKED" };
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
    case "GET_SECURITY_SETTINGS":
      return unlockedVault
        ? {
            ok: true,
            settings: {
              autoLockMinutes: unlockedVault.payload.settings.autoLockMinutes,
              clearClipboardSeconds: unlockedVault.payload.settings.clearClipboardSeconds,
            },
          }
        : { ok: false, error: "LOCKED" };
    case "UPDATE_SECURITY_SETTINGS": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      try {
        const next = updateSecuritySettings(
          unlockedVault.payload,
          request.settings.autoLockMinutes,
          request.settings.clearClipboardSeconds,
          { deviceId: await deviceId() },
        );
        if (!await persist(next)) return { ok: false, error: "PERSISTENCE_FAILED" };
        sessionDeadline.touch(sessionNow());
        browser.idle.setDetectionInterval(next.settings.autoLockMinutes * 60);
        scheduleSessionLock();
        return {
          ok: true,
          settings: {
            autoLockMinutes: next.settings.autoLockMinutes,
            clearClipboardSeconds: next.settings.clearClipboardSeconds,
          },
        };
      } catch {
        return { ok: false, error: "INVALID_REQUEST" };
      }
    }
    case "COPY_SECRET": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      try {
        const copied = await copySecret(request.value, unlockedVault.payload.settings.clearClipboardSeconds);
        return copied
          ? { ok: true, copied: true, clearAfterSeconds: unlockedVault.payload.settings.clearClipboardSeconds }
          : { ok: false, error: "INVALID_REQUEST" };
      } catch {
        return { ok: false, error: "INVALID_REQUEST" };
      }
    }
  }
}

function contentContext(sender: RuntimeSender): { tabId: number; origin: string } | null {
  if (typeof sender.tab?.id !== "number" || sender.frameId !== 0 || !sender.url) return null;
  const origin = normalizeOrigin(sender.url);
  return origin?.startsWith("https://") ? { tabId: sender.tab.id, origin } : null;
}

function publicCapture(pending: PendingCredentialCapture): PublicCapturePrompt | null {
  if (!unlockedVault) throw new Error("Vault is locked");
  const suggestion = suggestCredentialCapture(unlockedVault.payload, pending.credential);
  if (suggestion.action === "unchanged") return null;
  const matchingIds = new Set(suggestion.matchingLoginIds);
  return {
    id: pending.id,
    origin: pending.credential.origin,
    title: titleForOrigin(pending.credential.origin),
    username: pending.credential.username,
    suggestedAction: suggestion.action,
    ...(suggestion.suggestedItemId ? { suggestedItemId: suggestion.suggestedItemId } : {}),
    matches: unlockedVault.payload.items
      .filter((item) => matchingIds.has(item.id))
      .map(publicItem),
  };
}

async function handleContentRequest(request: ContentRequest, sender: RuntimeSender): Promise<ContentResponse> {
  enforceSessionDeadline();
  const context = contentContext(sender);
  if (!context) return { ok: false, error: "INVALID_REQUEST" };
  if (!unlockedVault) return { ok: false, error: "LOCKED" };
  touchSession();

  if (request.type === "CAPTURE_CREDENTIAL") {
    if (!validCapturedCredential(request.credential) || request.credential.origin.toLowerCase() !== context.origin) {
      return { ok: false, error: "INVALID_REQUEST" };
    }
    const suggestion = suggestCredentialCapture(unlockedVault.payload, request.credential);
    if (suggestion.action === "unchanged") return { ok: true, captureStatus: "unchanged" };
    const stored = pendingCaptures.put(context.tabId, request.credential);
    const prompt = publicCapture(stored);
    if (!prompt) {
      pendingCaptures.remove(context.tabId, stored.id);
      return { ok: true, captureStatus: "unchanged" };
    }
    return { ok: true, capture: prompt };
  }

  const pending = pendingCaptures.get(context.tabId);
  if (request.type === "GET_PENDING_CAPTURE") {
    if (!pending || pending.credential.origin.toLowerCase() !== context.origin) return { ok: true, capture: null };
    const prompt = publicCapture(pending);
    if (!prompt) {
      pendingCaptures.remove(context.tabId, pending.id);
      return { ok: true, captureStatus: "unchanged" };
    }
    return { ok: true, capture: prompt };
  }
  if (typeof request.captureId !== "string") return { ok: false, error: "INVALID_REQUEST" };
  if (!pending || pending.id !== request.captureId || pending.credential.origin.toLowerCase() !== context.origin) {
    return { ok: false, error: "EXPIRED" };
  }
  if (request.type === "DISMISS_CAPTURE") {
    pendingCaptures.remove(context.tabId, request.captureId);
    return { ok: true, captureStatus: "dismissed" };
  }

  if ((request.action !== "create" && request.action !== "update") || typeof request.confirmDuplicate !== "boolean" ||
    (request.action === "update" && typeof request.itemId !== "string")) {
    return { ok: false, error: "INVALID_REQUEST" };
  }

  try {
    if (request.action === "create") {
      const fields = loginFieldsForCapture(pending.credential);
      const duplicates = findLikelyLoginDuplicates(unlockedVault.payload, fields);
      if (duplicates.length && !request.confirmDuplicate) {
        return { ok: false, error: "DUPLICATE", items: duplicates.map(publicItem) };
      }
      const next = addLogin(unlockedVault.payload, fields, { deviceId: await deviceId() });
      if (!await persist(next)) return { ok: false, error: "PERSISTENCE_FAILED" };
    } else {
      const existing = request.itemId
        ? exactOriginLogins(unlockedVault.payload, pending.credential.origin).find((item) => item.id === request.itemId)
        : undefined;
      if (!existing) return { ok: false, error: "INVALID_REQUEST" };
      const fields = loginFieldsForCapture(pending.credential, existing);
      const duplicates = findLikelyLoginDuplicates(unlockedVault.payload, fields, existing.id);
      if (duplicates.length && !request.confirmDuplicate) {
        return { ok: false, error: "DUPLICATE", items: duplicates.map(publicItem) };
      }
      const next = editLogin(unlockedVault.payload, existing.id, fields, { deviceId: await deviceId() });
      if (!await persist(next)) return { ok: false, error: "PERSISTENCE_FAILED" };
    }
    pendingCaptures.remove(context.tabId, request.captureId);
    return { ok: true, captureStatus: "saved" };
  } catch {
    return { ok: false, error: "INVALID_REQUEST" };
  }
}

export function installBackground(): void {
  browser.idle.onStateChanged.addListener((state) => {
    if (state === "idle" || state === "locked") lockVault();
  });
  browser.runtime.onSuspend.addListener(lockVault);
  browser.tabs.onRemoved.addListener((tabId) => pendingCaptures.remove(tabId));
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo.url) return;
    pendingCaptures.retainOrigin(tabId, normalizeOrigin(changeInfo.url));
  });
  browser.runtime.onMessage.addListener((rawRequest: unknown, sender: RuntimeSender) => {
    if (rawRequest && typeof rawRequest === "object" && "type" in rawRequest) {
      if (rawRequest.type === "IRONKEEP_CLIPBOARD_WRITE" || rawRequest.type === "IRONKEEP_CLIPBOARD_CLEAR_NOW") return undefined;
      if (rawRequest.type === "IRONKEEP_CLIPBOARD_FINISHED") {
        const offscreen = offscreenApi();
        if (offscreen) void offscreen.closeDocument().catch(() => undefined);
        return undefined;
      }
    }
    if (!rawRequest || typeof rawRequest !== "object" || !("type" in rawRequest)) {
      return Promise.resolve({ ok: false, error: "INVALID_REQUEST" } satisfies ExtensionResponse);
    }
    if (rawRequest.type === "CAPTURE_CREDENTIAL" || rawRequest.type === "GET_PENDING_CAPTURE" ||
      rawRequest.type === "COMMIT_CAPTURE" || rawRequest.type === "DISMISS_CAPTURE") {
      return handleContentRequest(rawRequest as ContentRequest, sender as RuntimeSender);
    }
    return handleRequest(rawRequest as ExtensionRequest);
  });
}
