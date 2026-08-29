import {
  addLogin,
  addIdentity,
  addCreditCard,
  addSecureNote,
  createEmptyVault,
  createUnlockedVault,
  deleteLogin,
  deleteIdentity,
  deleteCreditCard,
  deleteSecureNote,
  editLogin,
  editIdentity,
  editCreditCard,
  editSecureNote,
  EphemeralCaptureStore,
  exactOriginLogins,
  findLikelyLoginDuplicates,
  findLikelyIdentityDuplicates,
  findLikelyCreditCardDuplicates,
  findLikelySecureNoteDuplicates,
  loginFieldsForCapture,
  persistVaultMutation,
  persistMasterPasswordChange,
  parseVaultFile,
  serializeVaultFile,
  applyVaultCsvImport,
  exportVaultCsv,
  previewVaultCsvImport,
  addCategory,
  addTag,
  deleteCategory,
  deleteTag,
  renameCategory,
  renameTag,
  setItemOrganization,
  SessionDeadline,
  shouldClearClipboard,
  suggestCredentialCapture,
  titleForOrigin,
  toggleLoginFavorite,
  toggleIdentityFavorite,
  toggleCreditCardFavorite,
  toggleSecureNoteFavorite,
  unlockVault,
  updateSecuritySettings,
  validCapturedCredential,
  type LoginFields,
  type IdentityFields,
  type IdentityItem,
  type CreditCardFields,
  type CreditCardItem,
  type LoginItem,
  type SecureNoteFields,
  type SecureNoteItem,
  type PendingCredentialCapture,
  type UnlockedVault,
  type VaultFile,
  type VaultItem,
  type ParsedCsvImportRecord,
} from "@ironkeep/shared";
import browser from "webextension-polyfill";
import type { ContentRequest, ContentResponse, ExtensionRequest, ExtensionResponse, PublicCapturePrompt, PublicCreditCard, PublicIdentity, PublicLogin, PublicSecureNote, PublicVaultItem } from "./types.js";

const STORAGE_KEY = "ironkeep.encryptedVault.v1";
const RECOVERY_KEY = "ironkeep.encryptedVault.recovery.v1";
const DEVICE_KEY = "ironkeep.deviceId";
const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
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
let pendingRestore: { token: string; session: UnlockedVault; file: VaultFile; createdAt: number } | null = null;
let pendingCsvImport: { token: string; records: ParsedCsvImportRecord[]; createdAt: number } | null = null;

function clearPendingRestore(): void {
  pendingRestore?.session.close();
  pendingRestore = null;
}

function clearPendingCsvImport(): void {
  pendingCsvImport = null;
}

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
  clearPendingRestore();
  clearPendingCsvImport();
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
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    subtitle,
    favorite: item.favorite,
    ...(item.categoryId === undefined ? {} : { categoryId: item.categoryId }),
    tagIds: [...item.tagIds],
  };
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

function publicSecureNote(item: SecureNoteItem): PublicSecureNote {
  return {
    ...publicItem(item),
    kind: "secureNote",
    body: item.body,
  };
}

function publicCreditCard(item: CreditCardItem): PublicCreditCard {
  return {
    ...publicItem(item),
    kind: "creditCard",
    cardholderName: item.cardholderName,
    number: item.number,
    expiryMonth: item.expiryMonth,
    expiryYear: item.expiryYear,
    verificationCode: item.verificationCode,
    ...(item.pin ? { pin: item.pin } : {}),
    notes: item.notes,
  };
}

function publicIdentity(item: IdentityItem): PublicIdentity {
  return {
    ...publicItem(item),
    kind: "identity",
    firstName: item.firstName,
    middleName: item.middleName,
    lastName: item.lastName,
    email: item.email,
    phone: item.phone,
    company: item.company,
    addressLine1: item.addressLine1,
    addressLine2: item.addressLine2,
    city: item.city,
    region: item.region,
    postalCode: item.postalCode,
    country: item.country,
    notes: item.notes,
  };
}

function validLoginFields(fields: LoginFields): boolean {
  return typeof fields.title === "string" && typeof fields.username === "string" &&
    typeof fields.password === "string" && Array.isArray(fields.uris) && fields.uris.every((value) => typeof value === "string") &&
    Array.isArray(fields.androidPackageNames) && fields.androidPackageNames.every((value) => typeof value === "string");
}

function validSecureNoteFields(fields: SecureNoteFields): boolean {
  return typeof fields.title === "string" && typeof fields.body === "string";
}

function validCreditCardFields(fields: CreditCardFields): boolean {
  return typeof fields.title === "string" && typeof fields.cardholderName === "string" && typeof fields.number === "string" &&
    typeof fields.expiryMonth === "number" && typeof fields.expiryYear === "number" && typeof fields.verificationCode === "string" &&
    (fields.pin === undefined || typeof fields.pin === "string") && typeof fields.notes === "string";
}

function validIdentityFields(fields: IdentityFields): boolean {
  return [fields.title, fields.firstName, fields.middleName, fields.lastName, fields.email, fields.phone, fields.company,
    fields.addressLine1, fields.addressLine2, fields.city, fields.region, fields.postalCode, fields.country, fields.notes]
    .every((value) => typeof value === "string");
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
    case "GET_SECURE_NOTE": {
      const item = unlockedVault?.payload.items.find((candidate): candidate is SecureNoteItem => candidate.kind === "secureNote" && candidate.id === request.itemId);
      return item ? { ok: true, item: publicSecureNote(item) } : { ok: false, error: unlockedVault ? "NOT_FOUND" : "LOCKED" };
    }
    case "CREATE_SECURE_NOTE": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      if (!validSecureNoteFields(request.fields)) return { ok: false, error: "INVALID_REQUEST" };
      const duplicates = findLikelySecureNoteDuplicates(unlockedVault.payload, request.fields);
      if (duplicates.length && !request.confirmDuplicate) return { ok: false, error: "DUPLICATE", items: duplicates.map(publicItem) };
      try {
        const next = addSecureNote(unlockedVault.payload, request.fields, { deviceId: await deviceId() });
        if (!await persist(next)) return { ok: false, error: "PERSISTENCE_FAILED" };
        const item = next.items.at(-1);
        return item?.kind === "secureNote" ? { ok: true, item: publicSecureNote(item) } : { ok: false, error: "INVALID_REQUEST" };
      } catch {
        return { ok: false, error: "INVALID_REQUEST" };
      }
    }
    case "UPDATE_SECURE_NOTE": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      if (!validSecureNoteFields(request.fields)) return { ok: false, error: "INVALID_REQUEST" };
      const duplicates = findLikelySecureNoteDuplicates(unlockedVault.payload, request.fields, request.itemId);
      if (duplicates.length && !request.confirmDuplicate) return { ok: false, error: "DUPLICATE", items: duplicates.map(publicItem) };
      try {
        const next = editSecureNote(unlockedVault.payload, request.itemId, request.fields, { deviceId: await deviceId() });
        if (!await persist(next)) return { ok: false, error: "PERSISTENCE_FAILED" };
        const item = next.items.find((candidate): candidate is SecureNoteItem => candidate.kind === "secureNote" && candidate.id === request.itemId);
        return item ? { ok: true, item: publicSecureNote(item) } : { ok: false, error: "NOT_FOUND" };
      } catch (error) {
        return { ok: false, error: error instanceof ReferenceError ? "NOT_FOUND" : "INVALID_REQUEST" };
      }
    }
    case "DELETE_SECURE_NOTE": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      if (!request.confirmed) return { ok: false, error: "INVALID_REQUEST" };
      try {
        const next = deleteSecureNote(unlockedVault.payload, request.itemId, { deviceId: await deviceId() });
        return await persist(next) ? { ok: true, status: "unlocked" } : { ok: false, error: "PERSISTENCE_FAILED" };
      } catch {
        return { ok: false, error: "NOT_FOUND" };
      }
    }
    case "TOGGLE_SECURE_NOTE_FAVORITE": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      try {
        const next = toggleSecureNoteFavorite(unlockedVault.payload, request.itemId, { deviceId: await deviceId() });
        if (!await persist(next)) return { ok: false, error: "PERSISTENCE_FAILED" };
        const item = next.items.find((candidate): candidate is SecureNoteItem => candidate.kind === "secureNote" && candidate.id === request.itemId);
        return item ? { ok: true, item: publicSecureNote(item) } : { ok: false, error: "NOT_FOUND" };
      } catch {
        return { ok: false, error: "NOT_FOUND" };
      }
    }
    case "GET_CREDIT_CARD": {
      const item = unlockedVault?.payload.items.find((candidate): candidate is CreditCardItem => candidate.kind === "creditCard" && candidate.id === request.itemId);
      return item ? { ok: true, item: publicCreditCard(item) } : { ok: false, error: unlockedVault ? "NOT_FOUND" : "LOCKED" };
    }
    case "CREATE_CREDIT_CARD": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      if (!validCreditCardFields(request.fields)) return { ok: false, error: "INVALID_REQUEST" };
      const duplicates = findLikelyCreditCardDuplicates(unlockedVault.payload, request.fields);
      if (duplicates.length && !request.confirmDuplicate) return { ok: false, error: "DUPLICATE", items: duplicates.map(publicItem) };
      try {
        const next = addCreditCard(unlockedVault.payload, request.fields, { deviceId: await deviceId() });
        if (!await persist(next)) return { ok: false, error: "PERSISTENCE_FAILED" };
        const item = next.items.at(-1);
        return item?.kind === "creditCard" ? { ok: true, item: publicCreditCard(item) } : { ok: false, error: "INVALID_REQUEST" };
      } catch {
        return { ok: false, error: "INVALID_REQUEST" };
      }
    }
    case "UPDATE_CREDIT_CARD": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      if (!validCreditCardFields(request.fields)) return { ok: false, error: "INVALID_REQUEST" };
      const duplicates = findLikelyCreditCardDuplicates(unlockedVault.payload, request.fields, request.itemId);
      if (duplicates.length && !request.confirmDuplicate) return { ok: false, error: "DUPLICATE", items: duplicates.map(publicItem) };
      try {
        const next = editCreditCard(unlockedVault.payload, request.itemId, request.fields, { deviceId: await deviceId() });
        if (!await persist(next)) return { ok: false, error: "PERSISTENCE_FAILED" };
        const item = next.items.find((candidate): candidate is CreditCardItem => candidate.kind === "creditCard" && candidate.id === request.itemId);
        return item ? { ok: true, item: publicCreditCard(item) } : { ok: false, error: "NOT_FOUND" };
      } catch (error) {
        return { ok: false, error: error instanceof ReferenceError ? "NOT_FOUND" : "INVALID_REQUEST" };
      }
    }
    case "DELETE_CREDIT_CARD": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      if (!request.confirmed) return { ok: false, error: "INVALID_REQUEST" };
      try {
        const next = deleteCreditCard(unlockedVault.payload, request.itemId, { deviceId: await deviceId() });
        return await persist(next) ? { ok: true, status: "unlocked" } : { ok: false, error: "PERSISTENCE_FAILED" };
      } catch {
        return { ok: false, error: "NOT_FOUND" };
      }
    }
    case "TOGGLE_CREDIT_CARD_FAVORITE": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      try {
        const next = toggleCreditCardFavorite(unlockedVault.payload, request.itemId, { deviceId: await deviceId() });
        if (!await persist(next)) return { ok: false, error: "PERSISTENCE_FAILED" };
        const item = next.items.find((candidate): candidate is CreditCardItem => candidate.kind === "creditCard" && candidate.id === request.itemId);
        return item ? { ok: true, item: publicCreditCard(item) } : { ok: false, error: "NOT_FOUND" };
      } catch {
        return { ok: false, error: "NOT_FOUND" };
      }
    }
    case "GET_IDENTITY": {
      const item = unlockedVault?.payload.items.find((candidate): candidate is IdentityItem => candidate.kind === "identity" && candidate.id === request.itemId);
      return item ? { ok: true, item: publicIdentity(item) } : { ok: false, error: unlockedVault ? "NOT_FOUND" : "LOCKED" };
    }
    case "CREATE_IDENTITY": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      if (!validIdentityFields(request.fields)) return { ok: false, error: "INVALID_REQUEST" };
      const duplicates = findLikelyIdentityDuplicates(unlockedVault.payload, request.fields);
      if (duplicates.length && !request.confirmDuplicate) return { ok: false, error: "DUPLICATE", items: duplicates.map(publicItem) };
      try {
        const next = addIdentity(unlockedVault.payload, request.fields, { deviceId: await deviceId() });
        if (!await persist(next)) return { ok: false, error: "PERSISTENCE_FAILED" };
        const item = next.items.at(-1);
        return item?.kind === "identity" ? { ok: true, item: publicIdentity(item) } : { ok: false, error: "INVALID_REQUEST" };
      } catch {
        return { ok: false, error: "INVALID_REQUEST" };
      }
    }
    case "UPDATE_IDENTITY": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      if (!validIdentityFields(request.fields)) return { ok: false, error: "INVALID_REQUEST" };
      const duplicates = findLikelyIdentityDuplicates(unlockedVault.payload, request.fields, request.itemId);
      if (duplicates.length && !request.confirmDuplicate) return { ok: false, error: "DUPLICATE", items: duplicates.map(publicItem) };
      try {
        const next = editIdentity(unlockedVault.payload, request.itemId, request.fields, { deviceId: await deviceId() });
        if (!await persist(next)) return { ok: false, error: "PERSISTENCE_FAILED" };
        const item = next.items.find((candidate): candidate is IdentityItem => candidate.kind === "identity" && candidate.id === request.itemId);
        return item ? { ok: true, item: publicIdentity(item) } : { ok: false, error: "NOT_FOUND" };
      } catch (error) {
        return { ok: false, error: error instanceof ReferenceError ? "NOT_FOUND" : "INVALID_REQUEST" };
      }
    }
    case "DELETE_IDENTITY": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      if (!request.confirmed) return { ok: false, error: "INVALID_REQUEST" };
      try {
        const next = deleteIdentity(unlockedVault.payload, request.itemId, { deviceId: await deviceId() });
        return await persist(next) ? { ok: true, status: "unlocked" } : { ok: false, error: "PERSISTENCE_FAILED" };
      } catch {
        return { ok: false, error: "NOT_FOUND" };
      }
    }
    case "TOGGLE_IDENTITY_FAVORITE": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      try {
        const next = toggleIdentityFavorite(unlockedVault.payload, request.itemId, { deviceId: await deviceId() });
        if (!await persist(next)) return { ok: false, error: "PERSISTENCE_FAILED" };
        const item = next.items.find((candidate): candidate is IdentityItem => candidate.kind === "identity" && candidate.id === request.itemId);
        return item ? { ok: true, item: publicIdentity(item) } : { ok: false, error: "NOT_FOUND" };
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
    case "CHANGE_MASTER_PASSWORD": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      if (request.newMasterPassword.length < 12 || request.currentMasterPassword === request.newMasterPassword) {
        return { ok: false, error: "INVALID_REQUEST" };
      }
      try {
        await persistMasterPasswordChange(
          unlockedVault,
          request.currentMasterPassword,
          request.newMasterPassword,
          async (file) => { await browser.storage.local.set({ [STORAGE_KEY]: file }); },
        );
        pendingCaptures.clear();
        return { ok: true, status: "unlocked" };
      } catch (error) {
        if (error instanceof Error && error.name === "VaultAuthenticationError") {
          return { ok: false, error: "AUTHENTICATION_FAILED" };
        }
        return { ok: false, error: "PERSISTENCE_FAILED" };
      }
    }
    case "EXPORT_ENCRYPTED_BACKUP": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      const file = await storedFile();
      if (!file) return { ok: false, error: "NOT_FOUND" };
      try {
        const bytes = serializeVaultFile(file);
        const backup = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return { ok: true, backup, fileName: `ironkeep-backup-${file.revision}.ikv` };
      } catch {
        return { ok: false, error: "INVALID_REQUEST" };
      }
    }
    case "PREVIEW_ENCRYPTED_RESTORE": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      clearPendingRestore();
      try {
        const bytes = new TextEncoder().encode(request.serializedVault);
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_BACKUP_BYTES) return { ok: false, error: "INVALID_REQUEST" };
        const file = parseVaultFile(bytes);
        const session = await unlockVault(request.masterPassword, file);
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
        const checksum = Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
        const token = crypto.randomUUID();
        pendingRestore = { token, session, file, createdAt: performance.now() };
        return {
          ok: true,
          restorePreview: {
            token,
            revision: session.payload.revision,
            updatedAt: session.payload.updatedAt,
            itemCount: session.payload.items.length,
            checksum,
          },
        };
      } catch (error) {
        clearPendingRestore();
        return {
          ok: false,
          error: error instanceof Error && error.name === "VaultAuthenticationError" ? "AUTHENTICATION_FAILED" : "INVALID_REQUEST",
        };
      }
    }
    case "CONFIRM_ENCRYPTED_RESTORE": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      const candidate = pendingRestore;
      if (!candidate || candidate.token !== request.token || performance.now() - candidate.createdAt >= 2 * 60 * 1_000) {
        clearPendingRestore();
        return { ok: false, error: "INVALID_REQUEST" };
      }
      const current = await storedFile();
      if (!current) return { ok: false, error: "NOT_FOUND" };
      try {
        await browser.storage.local.set({ [RECOVERY_KEY]: current, [STORAGE_KEY]: candidate.file });
        pendingRestore = null;
        openSession(candidate.session);
        pendingCaptures.clear();
        return { ok: true, status: "unlocked" };
      } catch {
        return { ok: false, error: "PERSISTENCE_FAILED" };
      }
    }
    case "CANCEL_ENCRYPTED_RESTORE":
      clearPendingRestore();
      return { ok: true, status: "unlocked" };
    case "DELETE_LOCAL_VAULT": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      if (request.confirmation !== "DELETE") return { ok: false, error: "INVALID_REQUEST" };
      const file = await storedFile();
      if (!file) return { ok: false, error: "NOT_FOUND" };
      try {
        const verification = await unlockVault(request.masterPassword, file);
        verification.close();
      } catch {
        return { ok: false, error: "AUTHENTICATION_FAILED" };
      }
      try {
        await browser.storage.local.remove([STORAGE_KEY, RECOVERY_KEY]);
        lockVault();
        return { ok: true, status: "empty" };
      } catch {
        return { ok: false, error: "PERSISTENCE_FAILED" };
      }
    }
    case "EXPORT_CSV": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      try {
        const file = await storedFile();
        if (!file) return { ok: false, error: "NOT_FOUND" };
        const verification = await unlockVault(request.masterPassword, file);
        verification.close();
        return { ok: true, csv: exportVaultCsv(unlockedVault.payload), fileName: `ironkeep-export-${unlockedVault.payload.revision}.csv` };
      } catch (error) {
        return { ok: false, error: error instanceof Error && error.name === "VaultAuthenticationError" ? "AUTHENTICATION_FAILED" : "INVALID_REQUEST" };
      }
    }
    case "PREVIEW_CSV_IMPORT": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      clearPendingCsvImport();
      try {
        const parsed = previewVaultCsvImport(unlockedVault.payload, request.csv);
        if (parsed.records.length === 0) return { ok: false, error: "INVALID_REQUEST" };
        const token = crypto.randomUUID();
        pendingCsvImport = { token, records: parsed.records, createdAt: performance.now() };
        return { ok: true, csvPreview: { token, ...parsed.preview } };
      } catch {
        return { ok: false, error: "INVALID_REQUEST" };
      }
    }
    case "CONFIRM_CSV_IMPORT": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      const candidate = pendingCsvImport;
      if (!candidate || candidate.token !== request.token || performance.now() - candidate.createdAt >= 2 * 60 * 1_000) {
        clearPendingCsvImport();
        return { ok: false, error: "INVALID_REQUEST" };
      }
      try {
        const next = applyVaultCsvImport(
          unlockedVault.payload,
          candidate.records,
          request.includeDuplicates,
          { deviceId: await deviceId() },
        );
        if (next === unlockedVault.payload) {
          clearPendingCsvImport();
          return { ok: true, status: "unlocked" };
        }
        if (!await persist(next)) return { ok: false, error: "PERSISTENCE_FAILED" };
        clearPendingCsvImport();
        return { ok: true, status: "unlocked" };
      } catch {
        return { ok: false, error: "INVALID_REQUEST" };
      }
    }
    case "CANCEL_CSV_IMPORT":
      clearPendingCsvImport();
      return { ok: true, status: "unlocked" };
    case "GET_ORGANIZATION":
      return unlockedVault ? {
        ok: true,
        organization: {
          categories: unlockedVault.payload.categories.map(({ id, name }) => ({ id, name })),
          tags: unlockedVault.payload.tags.map(({ id, name }) => ({ id, name })),
        },
      } : { ok: false, error: "LOCKED" };
    case "CREATE_CATEGORY":
    case "RENAME_CATEGORY":
    case "DELETE_CATEGORY":
    case "CREATE_TAG":
    case "RENAME_TAG":
    case "DELETE_TAG":
    case "SET_ITEM_ORGANIZATION": {
      if (!unlockedVault) return { ok: false, error: "LOCKED" };
      try {
        const context = { deviceId: await deviceId() };
        let next: UnlockedVault["payload"];
        if (request.type === "CREATE_CATEGORY") next = addCategory(unlockedVault.payload, request.name, context);
        else if (request.type === "RENAME_CATEGORY") next = renameCategory(unlockedVault.payload, request.categoryId, request.name, context);
        else if (request.type === "DELETE_CATEGORY") next = deleteCategory(unlockedVault.payload, request.categoryId, context);
        else if (request.type === "CREATE_TAG") next = addTag(unlockedVault.payload, request.name, context);
        else if (request.type === "RENAME_TAG") next = renameTag(unlockedVault.payload, request.tagId, request.name, context);
        else if (request.type === "DELETE_TAG") next = deleteTag(unlockedVault.payload, request.tagId, context);
        else next = setItemOrganization(unlockedVault.payload, request.itemId, request.categoryId, request.tagIds, context);
        if (!await persist(next)) return { ok: false, error: "PERSISTENCE_FAILED" };
        return {
          ok: true,
          organization: {
            categories: next.categories.map(({ id, name }) => ({ id, name })),
            tags: next.tags.map(({ id, name }) => ({ id, name })),
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
