import type { CreditCardItem, IdentityItem, LoginItem, SecureNoteItem, VaultCategory, VaultItem, VaultPayload, VaultTag } from "./models.js";
import { validateSecuritySettings } from "./session-security.js";

export interface LoginFields {
  title: string;
  username: string;
  password: string;
  uris: string[];
  androidPackageNames: string[];
}

export interface SecureNoteFields {
  title: string;
  body: string;
}

export interface CreditCardFields {
  title: string;
  cardholderName: string;
  number: string;
  expiryMonth: number;
  expiryYear: number;
  verificationCode: string;
  pin?: string;
  notes: string;
}

export interface IdentityFields {
  title: string;
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

export interface MutationContext {
  deviceId: string;
  now?: Date;
  itemId?: string;
}

function uniqueName(name: string, existing: Array<{ id: string; name: string }>, excludeId?: string): string {
  const normalized = name.trim();
  if (!normalized || normalized.length > 64) throw new RangeError("Name must be between 1 and 64 characters");
  if (existing.some((entry) => entry.id !== excludeId && entry.name.trim().toLowerCase() === normalized.toLowerCase())) {
    throw new RangeError("Name already exists");
  }
  return normalized;
}

function organizedItem(item: VaultItem, categoryId: string | undefined, tagIds: string[], updatedAt: string): VaultItem {
  const { categoryId: _existingCategoryId, ...withoutCategory } = item;
  return {
    ...withoutCategory,
    ...(categoryId === undefined ? {} : { categoryId }),
    tagIds,
    updatedAt,
    revision: item.revision + 1,
  } as VaultItem;
}

export function addCategory(payload: VaultPayload, name: string, context: MutationContext): VaultPayload {
  const updatedAt = timestamp(context);
  const category: VaultCategory = { id: crypto.randomUUID(), name: uniqueName(name, payload.categories), icon: "folder", color: "slate" };
  return { ...nextVault(payload, context, updatedAt), categories: [...payload.categories, category] };
}

export function renameCategory(payload: VaultPayload, categoryId: string, name: string, context: MutationContext): VaultPayload {
  if (!payload.categories.some((entry) => entry.id === categoryId)) throw new ReferenceError("Category not found");
  const normalized = uniqueName(name, payload.categories, categoryId);
  return { ...nextVault(payload, context, timestamp(context)), categories: payload.categories.map((entry) => entry.id === categoryId ? { ...entry, name: normalized } : entry) };
}

export function deleteCategory(payload: VaultPayload, categoryId: string, context: MutationContext): VaultPayload {
  if (!payload.categories.some((entry) => entry.id === categoryId)) throw new ReferenceError("Category not found");
  const updatedAt = timestamp(context);
  return {
    ...nextVault(payload, context, updatedAt),
    categories: payload.categories.filter((entry) => entry.id !== categoryId),
    items: payload.items.map((item) => item.categoryId === categoryId ? organizedItem(item, undefined, item.tagIds, updatedAt) : item),
  };
}

export function addTag(payload: VaultPayload, name: string, context: MutationContext): VaultPayload {
  const tag: VaultTag = { id: crypto.randomUUID(), name: uniqueName(name, payload.tags) };
  return { ...nextVault(payload, context, timestamp(context)), tags: [...payload.tags, tag] };
}

export function renameTag(payload: VaultPayload, tagId: string, name: string, context: MutationContext): VaultPayload {
  if (!payload.tags.some((entry) => entry.id === tagId)) throw new ReferenceError("Tag not found");
  const normalized = uniqueName(name, payload.tags, tagId);
  return { ...nextVault(payload, context, timestamp(context)), tags: payload.tags.map((entry) => entry.id === tagId ? { ...entry, name: normalized } : entry) };
}

export function deleteTag(payload: VaultPayload, tagId: string, context: MutationContext): VaultPayload {
  if (!payload.tags.some((entry) => entry.id === tagId)) throw new ReferenceError("Tag not found");
  const updatedAt = timestamp(context);
  return {
    ...nextVault(payload, context, updatedAt),
    tags: payload.tags.filter((entry) => entry.id !== tagId),
    items: payload.items.map((item) => item.tagIds.includes(tagId) ? { ...item, tagIds: item.tagIds.filter((id) => id !== tagId), updatedAt, revision: item.revision + 1 } : item),
  };
}

export function setItemOrganization(
  payload: VaultPayload,
  itemId: string,
  categoryId: string | undefined,
  tagIds: string[],
  context: MutationContext,
): VaultPayload {
  if (categoryId !== undefined && !payload.categories.some((entry) => entry.id === categoryId)) throw new ReferenceError("Category not found");
  const uniqueTagIds = [...new Set(tagIds)];
  if (uniqueTagIds.some((id) => !payload.tags.some((entry) => entry.id === id))) throw new ReferenceError("Tag not found");
  const existing = payload.items.find((item) => item.id === itemId);
  if (!existing) throw new ReferenceError("Item not found");
  const updatedAt = timestamp(context);
  return {
    ...nextVault(payload, context, updatedAt),
    items: payload.items.map((item) => item.id === itemId ? organizedItem(item, categoryId, uniqueTagIds, updatedAt) : item),
  };
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

function validateSecureNoteFields(fields: SecureNoteFields): SecureNoteFields {
  const normalized = { title: fields.title.trim(), body: fields.body };
  if (!normalized.title || !normalized.body.trim()) throw new RangeError("Secure note title and body are required");
  return normalized;
}

function validateCreditCardFields(fields: CreditCardFields): CreditCardFields {
  const normalized = {
    title: fields.title.trim(),
    cardholderName: fields.cardholderName.trim(),
    number: fields.number.replace(/[\s-]/gu, ""),
    expiryMonth: fields.expiryMonth,
    expiryYear: fields.expiryYear,
    verificationCode: fields.verificationCode.trim(),
    ...(fields.pin?.trim() ? { pin: fields.pin.trim() } : {}),
    notes: fields.notes,
  };
  if (!normalized.title || !normalized.cardholderName || !/^\d{12,19}$/u.test(normalized.number)) {
    throw new RangeError("Card title, cardholder, and a valid card number are required");
  }
  if (!Number.isInteger(normalized.expiryMonth) || normalized.expiryMonth < 1 || normalized.expiryMonth > 12 ||
      !Number.isInteger(normalized.expiryYear) || normalized.expiryYear < 2000 || normalized.expiryYear > 9999 ||
      !/^\d{3,4}$/u.test(normalized.verificationCode) || (normalized.pin !== undefined && !/^\d{3,12}$/u.test(normalized.pin))) {
    throw new RangeError("Card expiry or verification fields are invalid");
  }
  return normalized;
}

function validateIdentityFields(fields: IdentityFields): IdentityFields {
  const normalized = {
    title: fields.title.trim(),
    firstName: fields.firstName.trim(),
    middleName: fields.middleName.trim(),
    lastName: fields.lastName.trim(),
    email: fields.email.trim(),
    phone: fields.phone.trim(),
    company: fields.company.trim(),
    addressLine1: fields.addressLine1.trim(),
    addressLine2: fields.addressLine2.trim(),
    city: fields.city.trim(),
    region: fields.region.trim(),
    postalCode: fields.postalCode.trim(),
    country: fields.country.trim(),
    notes: fields.notes,
  };
  const hasDetails = Object.entries(normalized).some(([key, value]) => key !== "title" && key !== "notes" && value.length > 0);
  if (!normalized.title || !hasDetails) throw new RangeError("Identity title and at least one identity field are required");
  if (normalized.email && (!normalized.email.includes("@") || normalized.email.length > 320)) throw new RangeError("Identity email is invalid");
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

export function addSecureNote(payload: VaultPayload, fields: SecureNoteFields, context: MutationContext): VaultPayload {
  const values = validateSecureNoteFields(fields);
  const updatedAt = timestamp(context);
  const next = nextVault(payload, context, updatedAt);
  const itemId = context.itemId ?? crypto.randomUUID();
  if (payload.items.some((item) => item.id === itemId) || payload.tombstones.some((entry) => entry.itemId === itemId)) {
    throw new RangeError("Secure note identifier already exists");
  }
  const note: SecureNoteItem = {
    id: itemId,
    kind: "secureNote",
    ...values,
    tagIds: [],
    favorite: false,
    createdAt: updatedAt,
    updatedAt,
    revision: 1,
  };
  return { ...next, items: [...payload.items, note] };
}

export function editSecureNote(payload: VaultPayload, itemId: string, fields: SecureNoteFields, context: MutationContext): VaultPayload {
  const values = validateSecureNoteFields(fields);
  const existing = payload.items.find((item): item is SecureNoteItem => item.kind === "secureNote" && item.id === itemId);
  if (!existing) throw new ReferenceError("Secure note not found");
  const updatedAt = timestamp(context);
  const next = nextVault(payload, context, updatedAt);
  return {
    ...next,
    items: payload.items.map((item) => item.id === itemId ? { ...existing, ...values, updatedAt, revision: existing.revision + 1 } : item),
  };
}

export function deleteSecureNote(payload: VaultPayload, itemId: string, context: MutationContext): VaultPayload {
  const existing = payload.items.find((item) => item.kind === "secureNote" && item.id === itemId);
  if (!existing) throw new ReferenceError("Secure note not found");
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

export function toggleSecureNoteFavorite(payload: VaultPayload, itemId: string, context: MutationContext): VaultPayload {
  const existing = payload.items.find((item): item is SecureNoteItem => item.kind === "secureNote" && item.id === itemId);
  if (!existing) throw new ReferenceError("Secure note not found");
  const updatedAt = timestamp(context);
  const next = nextVault(payload, context, updatedAt);
  return {
    ...next,
    items: payload.items.map((item) => item.id === itemId ? { ...existing, favorite: !existing.favorite, updatedAt, revision: existing.revision + 1 } : item),
  };
}

export function findLikelySecureNoteDuplicates(payload: VaultPayload, fields: SecureNoteFields, excludeItemId?: string): SecureNoteItem[] {
  const title = fields.title.trim().toLowerCase();
  if (!title) return [];
  return payload.items.filter((item): item is SecureNoteItem =>
    item.kind === "secureNote" && item.id !== excludeItemId && item.title.trim().toLowerCase() === title,
  );
}

export function addCreditCard(payload: VaultPayload, fields: CreditCardFields, context: MutationContext): VaultPayload {
  const values = validateCreditCardFields(fields);
  const updatedAt = timestamp(context);
  const next = nextVault(payload, context, updatedAt);
  const itemId = context.itemId ?? crypto.randomUUID();
  if (payload.items.some((item) => item.id === itemId) || payload.tombstones.some((entry) => entry.itemId === itemId)) {
    throw new RangeError("Credit card identifier already exists");
  }
  const card: CreditCardItem = {
    id: itemId,
    kind: "creditCard",
    ...values,
    tagIds: [],
    favorite: false,
    createdAt: updatedAt,
    updatedAt,
    revision: 1,
  };
  return { ...next, items: [...payload.items, card] };
}

export function editCreditCard(payload: VaultPayload, itemId: string, fields: CreditCardFields, context: MutationContext): VaultPayload {
  const values = validateCreditCardFields(fields);
  const existing = payload.items.find((item): item is CreditCardItem => item.kind === "creditCard" && item.id === itemId);
  if (!existing) throw new ReferenceError("Credit card not found");
  const updatedAt = timestamp(context);
  const next = nextVault(payload, context, updatedAt);
  return {
    ...next,
    items: payload.items.map((item) => item.id === itemId ? { ...existing, ...values, updatedAt, revision: existing.revision + 1 } : item),
  };
}

export function deleteCreditCard(payload: VaultPayload, itemId: string, context: MutationContext): VaultPayload {
  const existing = payload.items.find((item) => item.kind === "creditCard" && item.id === itemId);
  if (!existing) throw new ReferenceError("Credit card not found");
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

export function toggleCreditCardFavorite(payload: VaultPayload, itemId: string, context: MutationContext): VaultPayload {
  const existing = payload.items.find((item): item is CreditCardItem => item.kind === "creditCard" && item.id === itemId);
  if (!existing) throw new ReferenceError("Credit card not found");
  const updatedAt = timestamp(context);
  const next = nextVault(payload, context, updatedAt);
  return {
    ...next,
    items: payload.items.map((item) => item.id === itemId ? { ...existing, favorite: !existing.favorite, updatedAt, revision: existing.revision + 1 } : item),
  };
}

export function findLikelyCreditCardDuplicates(payload: VaultPayload, fields: CreditCardFields, excludeItemId?: string): CreditCardItem[] {
  const number = fields.number.replace(/[\s-]/gu, "");
  if (!number) return [];
  return payload.items.filter((item): item is CreditCardItem =>
    item.kind === "creditCard" && item.id !== excludeItemId && item.number.replace(/[\s-]/gu, "") === number,
  );
}

export function addIdentity(payload: VaultPayload, fields: IdentityFields, context: MutationContext): VaultPayload {
  const values = validateIdentityFields(fields);
  const updatedAt = timestamp(context);
  const next = nextVault(payload, context, updatedAt);
  const itemId = context.itemId ?? crypto.randomUUID();
  if (payload.items.some((item) => item.id === itemId) || payload.tombstones.some((entry) => entry.itemId === itemId)) {
    throw new RangeError("Identity identifier already exists");
  }
  const identity: IdentityItem = {
    id: itemId,
    kind: "identity",
    ...values,
    tagIds: [],
    favorite: false,
    createdAt: updatedAt,
    updatedAt,
    revision: 1,
  };
  return { ...next, items: [...payload.items, identity] };
}

export function editIdentity(payload: VaultPayload, itemId: string, fields: IdentityFields, context: MutationContext): VaultPayload {
  const values = validateIdentityFields(fields);
  const existing = payload.items.find((item): item is IdentityItem => item.kind === "identity" && item.id === itemId);
  if (!existing) throw new ReferenceError("Identity not found");
  const updatedAt = timestamp(context);
  const next = nextVault(payload, context, updatedAt);
  return {
    ...next,
    items: payload.items.map((item) => item.id === itemId ? { ...existing, ...values, updatedAt, revision: existing.revision + 1 } : item),
  };
}

export function deleteIdentity(payload: VaultPayload, itemId: string, context: MutationContext): VaultPayload {
  const existing = payload.items.find((item) => item.kind === "identity" && item.id === itemId);
  if (!existing) throw new ReferenceError("Identity not found");
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

export function toggleIdentityFavorite(payload: VaultPayload, itemId: string, context: MutationContext): VaultPayload {
  const existing = payload.items.find((item): item is IdentityItem => item.kind === "identity" && item.id === itemId);
  if (!existing) throw new ReferenceError("Identity not found");
  const updatedAt = timestamp(context);
  const next = nextVault(payload, context, updatedAt);
  return {
    ...next,
    items: payload.items.map((item) => item.id === itemId ? { ...existing, favorite: !existing.favorite, updatedAt, revision: existing.revision + 1 } : item),
  };
}

export function findLikelyIdentityDuplicates(payload: VaultPayload, fields: IdentityFields, excludeItemId?: string): IdentityItem[] {
  const email = fields.email.trim().toLowerCase();
  const firstName = fields.firstName.trim().toLowerCase();
  const lastName = fields.lastName.trim().toLowerCase();
  const title = fields.title.trim().toLowerCase();
  return payload.items.filter((item): item is IdentityItem => {
    if (item.kind !== "identity" || item.id === excludeItemId) return false;
    if (email && item.email.trim().toLowerCase() === email) return true;
    return Boolean(firstName || lastName) && item.firstName.trim().toLowerCase() === firstName &&
      item.lastName.trim().toLowerCase() === lastName && item.title.trim().toLowerCase() === title;
  });
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
