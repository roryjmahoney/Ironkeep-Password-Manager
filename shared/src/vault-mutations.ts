import type { LoginItem, VaultPayload } from "./models.js";
import { validateSecuritySettings } from "./session-security.js";

export interface LoginFields {
  title: string;
  username: string;
  password: string;
  uris: string[];
  androidPackageNames: string[];
}

export interface MutationContext {
  deviceId: string;
  now?: Date;
  itemId?: string;
}

function timestamp(context: MutationContext): string {
  return (context.now ?? new Date()).toISOString();
}

function validateFields(fields: LoginFields): LoginFields {
  const normalized = {
    title: fields.title.trim(),
    username: fields.username.trim(),
    password: fields.password,
    uris: [...new Set(fields.uris.map((value) => value.trim()).filter(Boolean))],
    androidPackageNames: [...new Set(fields.androidPackageNames.map((value) => value.trim()).filter(Boolean))],
  };
  if (!normalized.title || !normalized.password) throw new RangeError("Login title and password are required");
  return normalized;
}

function nextVault(payload: VaultPayload, context: MutationContext, updatedAt: string): VaultPayload {
  if (!context.deviceId || payload.revision >= Number.MAX_SAFE_INTEGER) throw new RangeError("Invalid mutation metadata");
  return {
    ...payload,
    revision: payload.revision + 1,
    updatedAt,
    writerDeviceId: context.deviceId,
  };
}

export function addLogin(payload: VaultPayload, fields: LoginFields, context: MutationContext): VaultPayload {
  const values = validateFields(fields);
  const updatedAt = timestamp(context);
  const next = nextVault(payload, context, updatedAt);
  const itemId = context.itemId ?? crypto.randomUUID();
  if (payload.items.some((item) => item.id === itemId) || payload.tombstones.some((entry) => entry.itemId === itemId)) {
    throw new RangeError("Login identifier already exists");
  }
  const login: LoginItem = {
    id: itemId,
    kind: "login",
    ...values,
    tagIds: [],
    favorite: false,
    createdAt: updatedAt,
    updatedAt,
    revision: 1,
    notes: "",
  };
  return { ...next, items: [...payload.items, login] };
}

export function editLogin(payload: VaultPayload, itemId: string, fields: LoginFields, context: MutationContext): VaultPayload {
  const values = validateFields(fields);
  const existing = payload.items.find((item): item is LoginItem => item.kind === "login" && item.id === itemId);
  if (!existing) throw new ReferenceError("Login not found");
  const updatedAt = timestamp(context);
  const next = nextVault(payload, context, updatedAt);
  return {
    ...next,
    items: payload.items.map((item) => item.id === itemId ? { ...existing, ...values, updatedAt, revision: existing.revision + 1 } : item),
  };
}

export function deleteLogin(payload: VaultPayload, itemId: string, context: MutationContext): VaultPayload {
  const existing = payload.items.find((item) => item.kind === "login" && item.id === itemId);
  if (!existing) throw new ReferenceError("Login not found");
  const updatedAt = timestamp(context);
  const next = nextVault(payload, context, updatedAt);
  return {
    ...next,
    items: payload.items.filter((item) => item.id !== itemId),
    tombstones: [
      ...payload.tombstones.filter((entry) => entry.itemId !== itemId),
      { itemId, deletedAt: updatedAt, revision: next.revision, deviceId: context.deviceId },
    ],
  };
}

export function toggleLoginFavorite(payload: VaultPayload, itemId: string, context: MutationContext): VaultPayload {
  const existing = payload.items.find((item): item is LoginItem => item.kind === "login" && item.id === itemId);
  if (!existing) throw new ReferenceError("Login not found");
  const updatedAt = timestamp(context);
  const next = nextVault(payload, context, updatedAt);
  return {
    ...next,
    items: payload.items.map((item) => item.id === itemId ? { ...existing, favorite: !existing.favorite, updatedAt, revision: existing.revision + 1 } : item),
  };
}

export function updateSecuritySettings(
  payload: VaultPayload,
  autoLockMinutes: number,
  clearClipboardSeconds: number,
  context: MutationContext,
): VaultPayload {
  validateSecuritySettings(autoLockMinutes, clearClipboardSeconds);
  const updatedAt = timestamp(context);
  const next = nextVault(payload, context, updatedAt);
  return {
    ...next,
    settings: { ...payload.settings, autoLockMinutes, clearClipboardSeconds },
  };
}

function normalizedOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function findLikelyLoginDuplicates(payload: VaultPayload, fields: LoginFields, excludeItemId?: string): LoginItem[] {
  const username = fields.username.trim().toLowerCase();
  const title = fields.title.trim().toLowerCase();
  const origins = new Set(fields.uris.map(normalizedOrigin).filter((value): value is string => value !== null));
  const packages = new Set(fields.androidPackageNames.map((value) => value.trim().toLowerCase()).filter(Boolean));
  return payload.items.filter((item): item is LoginItem => {
    if (item.kind !== "login" || item.id === excludeItemId) return false;
    const sameIdentity = Boolean(username) && item.username.trim().toLowerCase() === username;
    const sameTarget = item.uris.some((value) => {
      const origin = normalizedOrigin(value);
      return origin !== null && origins.has(origin);
    }) || item.androidPackageNames.some((value) => packages.has(value.toLowerCase()));
    const sameTitle = Boolean(title) && item.title.trim().toLowerCase() === title;
    return (sameTarget && (sameIdentity || sameTitle)) || (sameIdentity && sameTitle);
  });
}
