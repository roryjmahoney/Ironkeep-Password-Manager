import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyVault, type LoginItem } from "./models.js";
import { addLogin, editLogin } from "./vault-mutations.js";
import {
  detectCapturedCredential,
  EphemeralCaptureStore,
  loginFieldsForCapture,
  suggestCredentialCapture,
  validCapturedCredential,
  type BrowserFormFieldSnapshot,
  type CapturedCredential,
} from "./browser-capture.js";

const origin = "https://accounts.example.com";
const capture: CapturedCredential = { origin, username: "rory@example.com", password: "new-password" };

function field(values: Partial<BrowserFormFieldSnapshot>): BrowserFormFieldSnapshot {
  return { type: "text", autocomplete: "", name: "", id: "", value: "", disabled: false, readOnly: false, ...values };
}

function login(id: string, username: string, password: string): LoginItem {
  return {
    id,
    kind: "login",
    title: "Example",
    username,
    password,
    uris: [origin],
    androidPackageNames: ["com.example"],
    notes: "",
    tagIds: [],
    favorite: false,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    revision: 1,
  };
}

describe("browser credential capture", () => {
  afterEach(() => vi.useRealTimers());

  it("detects signup fields and rejects mismatched password confirmation", () => {
    const fields = [
      field({ type: "email", autocomplete: "email", value: "rory@example.com" }),
      field({ type: "password", autocomplete: "new-password", value: "generated-password" }),
      field({ type: "password", name: "confirm_password", value: "generated-password" }),
    ];
    expect(detectCapturedCredential(fields, origin)).toEqual({ origin, username: "rory@example.com", password: "generated-password" });
    fields[2] = field({ type: "password", name: "confirm_password", value: "different" });
    expect(detectCapturedCredential(fields, origin)).toBeNull();
  });

  it("prefers the new password on password-change forms", () => {
    const result = detectCapturedCredential([
      field({ autocomplete: "username", value: "rory@example.com" }),
      field({ type: "password", autocomplete: "current-password", value: "old" }),
      field({ type: "password", autocomplete: "new-password", value: "new" }),
    ], origin);
    expect(result?.password).toBe("new");
  });

  it("handles camel-case confirmation fields without autocomplete metadata", () => {
    const fields = [
      field({ name: "account", value: "rory" }),
      field({ type: "password", name: "newPassword", value: "new" }),
      field({ type: "password", name: "passwordConfirmation", value: "new" }),
    ];
    expect(detectCapturedCredential(fields, origin)?.password).toBe("new");
    fields[2] = field({ type: "password", name: "passwordConfirmation", value: "different" });
    expect(detectCapturedCredential(fields, origin)).toBeNull();
  });

  it("requires an exact HTTPS origin and bounded values", () => {
    expect(validCapturedCredential(capture)).toBe(true);
    expect(validCapturedCredential({ ...capture, origin: "http://accounts.example.com" })).toBe(false);
    expect(validCapturedCredential({ ...capture, origin: `${origin}/login` })).toBe(false);
    expect(validCapturedCredential({ ...capture, password: "x".repeat(4_097) })).toBe(false);
    expect(validCapturedCredential(undefined)).toBe(false);
  });

  it("ignores hidden identifier fields", () => {
    const result = detectCapturedCredential([
      field({ type: "hidden", name: "username", value: "tracking-value" }),
      field({ type: "password", autocomplete: "current-password", value: "password" }),
    ], origin);
    expect(result?.username).toBe("");
  });

  it("suggests create, update, choice, and unchanged without adjacent-origin matching", () => {
    const payload = createEmptyVault("Test", "device");
    const first = login("first", "rory@example.com", "old");
    const adjacent = { ...login("adjacent", "rory@example.com", "other"), uris: ["https://example.com"] };
    payload.items = [first, adjacent];
    expect(suggestCredentialCapture(payload, capture)).toEqual({ action: "update", matchingLoginIds: ["first"], suggestedItemId: "first" });
    expect(suggestCredentialCapture(payload, { ...capture, password: "old" }).action).toBe("unchanged");
    expect(suggestCredentialCapture(payload, { ...capture, username: "different@example.com" }).action).toBe("create");
    payload.items = [first, login("second", "rory@example.com", "older")];
    expect(suggestCredentialCapture(payload, capture).action).toBe("choose");
  });

  it("preserves existing metadata while replacing captured login fields", () => {
    const existing = login("first", "old@example.com", "old");
    const fields = loginFieldsForCapture(capture, existing);
    expect(fields).toEqual({
      title: "Example",
      username: "rory@example.com",
      password: "new-password",
      uris: [origin],
      androidPackageNames: ["com.example"],
    });
    expect(loginFieldsForCapture(capture).title).toBe("accounts.example.com");
  });

  it("routes confirmed captures through normal revisioned login mutations", () => {
    const payload = createEmptyVault("Test", "device");
    const created = addLogin(payload, loginFieldsForCapture(capture), {
      deviceId: "writer",
      itemId: "captured",
      now: new Date("2026-08-25T01:00:00.000Z"),
    });
    expect(created.revision).toBe(payload.revision + 1);
    const existing = created.items.find((item): item is LoginItem => item.kind === "login" && item.id === "captured")!;
    const updated = editLogin(created, existing.id, loginFieldsForCapture({ ...capture, password: "changed" }, existing), {
      deviceId: "writer",
      now: new Date("2026-08-25T02:00:00.000Z"),
    });
    expect(updated.revision).toBe(created.revision + 1);
    expect((updated.items[0] as LoginItem).password).toBe("changed");
  });

  it("keeps one short-lived capture per tab and wipes it on every terminal path", () => {
    vi.useFakeTimers();
    const store = new EphemeralCaptureStore(100, () => "capture-id");
    const first = store.put(7, capture);
    expect(store.get(7)?.id).toBe("capture-id");
    store.retainOrigin(7, origin);
    expect(store.get(7)).toBeDefined();
    store.retainOrigin(7, "https://other.example.com");
    expect(store.get(7)).toBeUndefined();
    expect(first.credential.password).toBe("");

    const replacement = store.put(7, capture);
    store.remove(7, "stale-id");
    expect(store.get(7)?.id).toBe(replacement.id);
    vi.advanceTimersByTime(100);
    expect(store.get(7)).toBeUndefined();

    const final = store.put(8, capture);
    store.clear();
    expect(store.get(8)).toBeUndefined();
    expect(final.credential.username).toBe("");
  });
});
