import { describe, expect, it } from "vitest";
import { createEmptyVault } from "./models.js";
import { addLogin, deleteLogin, editLogin, findLikelyLoginDuplicates, toggleLoginFavorite } from "./vault-mutations.js";

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
});
