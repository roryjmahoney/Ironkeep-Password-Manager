import { describe, expect, it } from "vitest";
import { createEmptyVault } from "./models.js";
import { addCreditCard, addIdentity, addLogin, addSecureNote, deleteCreditCard, deleteIdentity, deleteLogin, deleteSecureNote, editCreditCard, editIdentity, editLogin, editSecureNote, findLikelyCreditCardDuplicates, findLikelyIdentityDuplicates, findLikelyLoginDuplicates, findLikelySecureNoteDuplicates, toggleCreditCardFavorite, toggleIdentityFavorite, toggleLoginFavorite, toggleSecureNoteFavorite, updateSecuritySettings } from "./vault-mutations.js";

const fields = {
  title: "Example",
  username: "person@example.com",
  password: "secret",
  uris: ["https://example.com/login"],
  androidPackageNames: ["com.example.app"],
};

describe("login mutations", () => {
  it("adds, edits, favorites, and tombstones a login with monotonic revisions and timestamps", () => {
    const empty = createEmptyVault("Test", "device-a", new Date("2026-01-01T00:00:00.000Z"));
    const added = addLogin(empty, fields, { deviceId: "device-a", now: new Date("2026-01-02T00:00:00.000Z"), itemId: "login-one" });
    expect(added).toMatchObject({ revision: 2, updatedAt: "2026-01-02T00:00:00.000Z", writerDeviceId: "device-a" });
    expect(added.items[0]).toMatchObject({ id: "login-one", revision: 1, createdAt: "2026-01-02T00:00:00.000Z" });

    const edited = editLogin(added, "login-one", { ...fields, title: "Updated" }, { deviceId: "device-b", now: new Date("2026-01-03T00:00:00.000Z") });
    expect(edited).toMatchObject({ revision: 3, writerDeviceId: "device-b" });
    expect(edited.items[0]).toMatchObject({ title: "Updated", revision: 2, createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" });

    const favorited = toggleLoginFavorite(edited, "login-one", { deviceId: "device-b", now: new Date("2026-01-04T00:00:00.000Z") });
    expect(favorited.items[0]).toMatchObject({ favorite: true, revision: 3 });

    const deleted = deleteLogin(favorited, "login-one", { deviceId: "device-b", now: new Date("2026-01-05T00:00:00.000Z") });
    expect(deleted.items).toHaveLength(0);
    expect(deleted.tombstones).toEqual([{ itemId: "login-one", deletedAt: "2026-01-05T00:00:00.000Z", revision: 5, deviceId: "device-b" }]);
  });

  it("warns for the same identifier on an exact origin or Android package", () => {
    const vault = addLogin(createEmptyVault("Test", "device-a"), fields, { deviceId: "device-a", itemId: "login-one" });
    expect(findLikelyLoginDuplicates(vault, { ...fields, uris: ["https://example.com/other"], androidPackageNames: [] })).toHaveLength(1);
    expect(findLikelyLoginDuplicates(vault, { ...fields, title: "Other", username: "other@example.com", uris: ["https://other.example"], androidPackageNames: [] })).toHaveLength(0);
  });

  it("persists security settings as one normal vault revision", () => {
    const empty = createEmptyVault("Test", "device-a", new Date("2026-01-01T00:00:00.000Z"));
    const updated = updateSecuritySettings(empty, 15, 60, { deviceId: "device-b", now: new Date("2026-01-02T00:00:00.000Z") });
    expect(updated).toMatchObject({
      revision: 2,
      updatedAt: "2026-01-02T00:00:00.000Z",
      writerDeviceId: "device-b",
      settings: { autoLockMinutes: 15, clearClipboardSeconds: 60 },
    });
    expect(() => updateSecuritySettings(updated, 0, 60, { deviceId: "device-b" })).toThrow(RangeError);
  });
});

describe("secure note mutations", () => {
  it("adds, edits, favorites, and tombstones a note without changing its identity", () => {
    const empty = createEmptyVault("Test", "device-a", new Date("2026-01-01T00:00:00.000Z"));
    const added = addSecureNote(empty, { title: "Recovery", body: "Offline codes" }, { deviceId: "device-a", now: new Date("2026-01-02T00:00:00.000Z"), itemId: "note-one" });
    expect(added.items[0]).toMatchObject({ id: "note-one", kind: "secureNote", revision: 1, title: "Recovery", body: "Offline codes" });

    const edited = editSecureNote(added, "note-one", { title: "Recovery codes", body: "Updated codes" }, { deviceId: "device-b", now: new Date("2026-01-03T00:00:00.000Z") });
    expect(edited.items[0]).toMatchObject({ id: "note-one", revision: 2, title: "Recovery codes", body: "Updated codes", createdAt: "2026-01-02T00:00:00.000Z" });

    const favorite = toggleSecureNoteFavorite(edited, "note-one", { deviceId: "device-b", now: new Date("2026-01-04T00:00:00.000Z") });
    expect(favorite.items[0]).toMatchObject({ favorite: true, revision: 3 });

    const deleted = deleteSecureNote(favorite, "note-one", { deviceId: "device-b", now: new Date("2026-01-05T00:00:00.000Z") });
    expect(deleted.items).toHaveLength(0);
    expect(deleted.tombstones).toContainEqual({ itemId: "note-one", deletedAt: "2026-01-05T00:00:00.000Z", revision: 5, deviceId: "device-b" });
  });

  it("validates content and detects duplicate titles", () => {
    const empty = createEmptyVault("Test", "device-a");
    expect(() => addSecureNote(empty, { title: "", body: "body" }, { deviceId: "device-a" })).toThrow(RangeError);
    expect(() => addSecureNote(empty, { title: "Title", body: "  " }, { deviceId: "device-a" })).toThrow(RangeError);
    const added = addSecureNote(empty, { title: "Recovery", body: "codes" }, { deviceId: "device-a", itemId: "note-one" });
    expect(findLikelySecureNoteDuplicates(added, { title: " recovery ", body: "different" })).toHaveLength(1);
    expect(findLikelySecureNoteDuplicates(added, { title: "Other", body: "different" })).toHaveLength(0);
  });
});

describe("credit card mutations", () => {
  const card = {
    title: "Travel card",
    cardholderName: "A Person",
    number: "4111 1111 1111 1111",
    expiryMonth: 12,
    expiryYear: 2030,
    verificationCode: "123",
    pin: "9876",
    notes: "Use abroad",
  };

  it("normalizes, edits, favorites, and tombstones a card", () => {
    const empty = createEmptyVault("Test", "device-a", new Date("2026-01-01T00:00:00.000Z"));
    const added = addCreditCard(empty, card, { deviceId: "device-a", now: new Date("2026-01-02T00:00:00.000Z"), itemId: "card-one" });
    expect(added.items[0]).toMatchObject({ id: "card-one", kind: "creditCard", number: "4111111111111111", revision: 1 });
    const edited = editCreditCard(added, "card-one", { ...card, title: "Primary card", notes: "Updated" }, { deviceId: "device-b", now: new Date("2026-01-03T00:00:00.000Z") });
    expect(edited.items[0]).toMatchObject({ title: "Primary card", notes: "Updated", revision: 2, createdAt: "2026-01-02T00:00:00.000Z" });
    const favorite = toggleCreditCardFavorite(edited, "card-one", { deviceId: "device-b", now: new Date("2026-01-04T00:00:00.000Z") });
    expect(favorite.items[0]).toMatchObject({ favorite: true, revision: 3 });
    const deleted = deleteCreditCard(favorite, "card-one", { deviceId: "device-b", now: new Date("2026-01-05T00:00:00.000Z") });
    expect(deleted.items).toHaveLength(0);
    expect(deleted.tombstones).toContainEqual({ itemId: "card-one", deletedAt: "2026-01-05T00:00:00.000Z", revision: 5, deviceId: "device-b" });
  });

  it("rejects invalid fields and detects the same normalized card number", () => {
    const empty = createEmptyVault("Test", "device-a");
    expect(() => addCreditCard(empty, { ...card, number: "123" }, { deviceId: "device-a" })).toThrow(RangeError);
    expect(() => addCreditCard(empty, { ...card, expiryMonth: 13 }, { deviceId: "device-a" })).toThrow(RangeError);
    expect(() => addCreditCard(empty, { ...card, verificationCode: "x" }, { deviceId: "device-a" })).toThrow(RangeError);
    const added = addCreditCard(empty, card, { deviceId: "device-a", itemId: "card-one" });
    expect(findLikelyCreditCardDuplicates(added, { ...card, number: "4111-1111-1111-1111" })).toHaveLength(1);
  });
});

describe("identity mutations", () => {
  const identity = {
    title: "Personal identity",
    firstName: "Alex",
    middleName: "Q",
    lastName: "Person",
    email: "alex@example.com",
    phone: "+1 555 0100",
    company: "Example",
    addressLine1: "1 Main Street",
    addressLine2: "Unit 2",
    city: "Seattle",
    region: "WA",
    postalCode: "98101",
    country: "US",
    notes: "Primary",
  };

  it("adds, edits, favorites, and tombstones an identity", () => {
    const empty = createEmptyVault("Test", "device-a", new Date("2026-01-01T00:00:00.000Z"));
    const added = addIdentity(empty, identity, { deviceId: "device-a", now: new Date("2026-01-02T00:00:00.000Z"), itemId: "identity-one" });
    expect(added.items[0]).toMatchObject({ id: "identity-one", kind: "identity", firstName: "Alex", revision: 1 });
    const edited = editIdentity(added, "identity-one", { ...identity, company: "Updated" }, { deviceId: "device-b", now: new Date("2026-01-03T00:00:00.000Z") });
    expect(edited.items[0]).toMatchObject({ company: "Updated", revision: 2, createdAt: "2026-01-02T00:00:00.000Z" });
    const favorite = toggleIdentityFavorite(edited, "identity-one", { deviceId: "device-b", now: new Date("2026-01-04T00:00:00.000Z") });
    expect(favorite.items[0]).toMatchObject({ favorite: true, revision: 3 });
    const deleted = deleteIdentity(favorite, "identity-one", { deviceId: "device-b", now: new Date("2026-01-05T00:00:00.000Z") });
    expect(deleted.items).toHaveLength(0);
    expect(deleted.tombstones).toContainEqual({ itemId: "identity-one", deletedAt: "2026-01-05T00:00:00.000Z", revision: 5, deviceId: "device-b" });
  });

  it("requires useful details and detects duplicate email", () => {
    const empty = createEmptyVault("Test", "device-a");
    const blank = Object.fromEntries(Object.keys(identity).map((key) => [key, key === "title" ? "Empty" : ""])) as typeof identity;
    expect(() => addIdentity(empty, blank, { deviceId: "device-a" })).toThrow(RangeError);
    expect(() => addIdentity(empty, { ...identity, email: "invalid" }, { deviceId: "device-a" })).toThrow(RangeError);
    const added = addIdentity(empty, identity, { deviceId: "device-a", itemId: "identity-one" });
    expect(findLikelyIdentityDuplicates(added, { ...identity, title: "Other", email: " ALEX@example.com " })).toHaveLength(1);
  });
});
