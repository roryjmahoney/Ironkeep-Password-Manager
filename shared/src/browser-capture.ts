import type { LoginItem, VaultPayload } from "./models.js";
import type { LoginFields } from "./vault-mutations.js";

export const CAPTURE_TTL_MS = 120_000;
const MAX_USERNAME_LENGTH = 512;
const MAX_PASSWORD_LENGTH = 4_096;

export interface BrowserFormFieldSnapshot {
  type: string;
  autocomplete: string;
  name: string;
  id: string;
  value: string;
  disabled: boolean;
  readOnly: boolean;
}

export interface CapturedCredential {
  origin: string;
  username: string;
  password: string;
}

export interface PendingCredentialCapture {
  id: string;
  tabId: number;
  credential: CapturedCredential;
}

interface StoredCredentialCapture extends PendingCredentialCapture {
  timer: ReturnType<typeof setTimeout>;
}

export class EphemeralCaptureStore {
  private readonly captures = new Map<number, StoredCredentialCapture>();

  constructor(
    private readonly ttlMs = CAPTURE_TTL_MS,
    private readonly idFactory: () => string = () => crypto.randomUUID(),
  ) {}

  put(tabId: number, credential: CapturedCredential): PendingCredentialCapture {
    if (!Number.isSafeInteger(tabId) || tabId < 0 || !validCapturedCredential(credential)) throw new RangeError("Invalid capture context");
    this.remove(tabId);
    const id = this.idFactory();
    const stored: StoredCredentialCapture = {
      id,
      tabId,
      credential: { ...credential },
      timer: setTimeout(() => this.remove(tabId, id), this.ttlMs),
    };
    this.captures.set(tabId, stored);
    return stored;
  }

  get(tabId: number): PendingCredentialCapture | undefined {
    return this.captures.get(tabId);
  }

  remove(tabId: number, captureId?: string): void {
    const stored = this.captures.get(tabId);
    if (!stored || (captureId && stored.id !== captureId)) return;
    clearTimeout(stored.timer);
    this.captures.delete(tabId);
    stored.credential.password = "";
    stored.credential.username = "";
  }

  retainOrigin(tabId: number, origin: string | null): void {
    const stored = this.captures.get(tabId);
    if (stored && stored.credential.origin.toLowerCase() !== origin?.toLowerCase()) this.remove(tabId);
  }

  clear(): void {
    for (const tabId of this.captures.keys()) this.remove(tabId);
  }
}

export type CaptureSuggestion =
  | { action: "unchanged"; matchingLoginIds: string[] }
  | { action: "create" | "update" | "choose"; matchingLoginIds: string[]; suggestedItemId?: string };

function fieldIdentity(field: BrowserFormFieldSnapshot): string {
  return `${field.autocomplete} ${field.name} ${field.id}`.toLowerCase();
}

function usable(field: BrowserFormFieldSnapshot): boolean {
  return !field.disabled && !field.readOnly && field.value.length > 0;
}

export function detectCapturedCredential(fields: BrowserFormFieldSnapshot[], origin: string): CapturedCredential | null {
  const passwords = fields.filter((field) => field.type.toLowerCase() === "password" && usable(field));
  if (!passwords.length) return null;

  const confirmation = passwords.find((field) => /confirm|repeat/u.test(fieldIdentity(field)));
  const explicitNewPasswords = passwords.filter((field) =>
    field.autocomplete.toLowerCase() === "new-password" || /new.?pass/u.test(fieldIdentity(field)),
  );
  if (new Set(explicitNewPasswords.map((field) => field.value)).size > 1) return null;
  const primaryNewPassword = explicitNewPasswords.find((field) => field !== confirmation)
    ?? passwords.find((field) => field !== confirmation && field.autocomplete.toLowerCase() !== "current-password");
  if (confirmation && (!primaryNewPassword || confirmation.value !== primaryNewPassword.value)) return null;
  const password = primaryNewPassword?.value ?? passwords[0]?.value ?? "";

  const identifiers = fields.filter((field) => /^(?:text|email|tel)$/u.test(field.type.toLowerCase()) && usable(field));
  const username = identifiers.find((field) => /^(?:username|email|tel)$/u.test(field.autocomplete.toLowerCase()))
    ?? identifiers.find((field) => /^(?:email|tel)$/u.test(field.type.toLowerCase()))
    ?? identifiers.find((field) => /user|email|login|phone|account/u.test(fieldIdentity(field)));

  const capture = { origin, username: username?.value ?? "", password };
  return validCapturedCredential(capture) ? capture : null;
}

export function validCapturedCredential(capture: unknown): capture is CapturedCredential {
  if (!capture || typeof capture !== "object") return false;
  const candidate = capture as Partial<CapturedCredential>;
  if (typeof candidate.origin !== "string" || typeof candidate.username !== "string" || typeof candidate.password !== "string") return false;
  if (candidate.username.length > MAX_USERNAME_LENGTH || candidate.password.length < 1 || candidate.password.length > MAX_PASSWORD_LENGTH) return false;
  try {
    const url = new URL(candidate.origin);
    return url.protocol === "https:" && url.origin.toLowerCase() === candidate.origin.toLowerCase();
  } catch {
    return false;
  }
}

export function titleForOrigin(origin: string): string {
  const hostname = new URL(origin).hostname.toLowerCase().replace(/^www\./u, "");
  return hostname || origin;
}

function normalizedOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function exactOriginLogins(payload: VaultPayload, origin: string): LoginItem[] {
  const normalized = normalizedOrigin(origin);
  if (!normalized) return [];
  return payload.items.filter((item): item is LoginItem =>
    item.kind === "login" && item.uris.some((uri) => normalizedOrigin(uri) === normalized),
  );
}

export function suggestCredentialCapture(payload: VaultPayload, capture: CapturedCredential): CaptureSuggestion {
  if (!validCapturedCredential(capture)) throw new RangeError("Invalid captured credential");
  const matches = exactOriginLogins(payload, capture.origin);
  const username = capture.username.trim().toLowerCase();
  const identityMatches = username
    ? matches.filter((item) => item.username.trim().toLowerCase() === username)
    : matches;
  const unchanged = identityMatches.find((item) => item.password === capture.password);
  if (unchanged) return { action: "unchanged", matchingLoginIds: [unchanged.id] };
  if (identityMatches.length === 1) {
    return { action: "update", matchingLoginIds: matches.map((item) => item.id), suggestedItemId: identityMatches[0]!.id };
  }
  if (identityMatches.length > 1 || (!username && matches.length > 1)) {
    return { action: "choose", matchingLoginIds: matches.map((item) => item.id) };
  }
  return { action: "create", matchingLoginIds: matches.map((item) => item.id) };
}

export function loginFieldsForCapture(capture: CapturedCredential, existing?: LoginItem): LoginFields {
  if (!validCapturedCredential(capture)) throw new RangeError("Invalid captured credential");
  if (!existing) {
    return {
      title: titleForOrigin(capture.origin),
      username: capture.username,
      password: capture.password,
      uris: [capture.origin],
      androidPackageNames: [],
    };
  }
  const origins = existing.uris.some((uri) => normalizedOrigin(uri) === capture.origin.toLowerCase())
    ? [...existing.uris]
    : [...existing.uris, capture.origin];
  return {
    title: existing.title,
    username: capture.username || existing.username,
    password: capture.password,
    uris: origins,
    androidPackageNames: [...existing.androidPackageNames],
  };
}
