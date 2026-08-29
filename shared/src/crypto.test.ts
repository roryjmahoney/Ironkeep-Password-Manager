import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createEmptyVault } from "./models.js";
import {
  createUnlockedVault,
  decryptVault,
  encryptVault,
  parseVaultFile,
  persistMasterPasswordChange,
  persistVaultMutation,
  serializeVaultFile,
  unlockVault,
  VaultAuthenticationError,
} from "./crypto.js";
import { addLogin } from "./vault-mutations.js";

const testKdf = { memoryKiB: 19 * 1024, iterations: 2, parallelism: 1 } as const;

describe("Ironkeep vault envelope", () => {
  it("changes the master password without changing vault data", async () => {
    const payload = createEmptyVault("Test", "device-a", new Date("2026-01-01T00:00:00.000Z"));
    const created = await createUnlockedVault("correct horse battery staple", payload, { kdf: testKdf });
    let durableFile = created.file;

    await persistMasterPasswordChange(
      created.session,
      "correct horse battery staple",
      "new correct horse battery staple",
      async (file) => { durableFile = file; },
      { kdf: testKdf },
    );

    await expect(unlockVault("correct horse battery staple", durableFile)).rejects.toThrow(VaultAuthenticationError);
    const reopened = await unlockVault("new correct horse battery staple", durableFile);
    expect(reopened.payload).toEqual(payload);
    reopened.close();
    created.session.close();
  });

  it("keeps the prior password when password-change persistence fails", async () => {
    const payload = createEmptyVault("Test", "device-a", new Date("2026-01-01T00:00:00.000Z"));
    const created = await createUnlockedVault("correct horse battery staple", payload, { kdf: testKdf });

    await expect(persistMasterPasswordChange(
      created.session,
      "correct horse battery staple",
      "new correct horse battery staple",
      async () => { throw new Error("disk full"); },
      { kdf: testKdf },
    )).rejects.toThrow("disk full");

    await expect(created.session.changeMasterPassword(
      "correct horse battery staple",
      "another correct horse battery staple",
      { kdf: testKdf },
    )).resolves.toBeDefined();
    await expect(created.session.changeMasterPassword(
      "new correct horse battery staple",
      "another correct horse battery staple",
      { kdf: testKdf },
    )).rejects.toThrow(VaultAuthenticationError);
    created.session.close();
  });
  it("decrypts the shared interoperability vector", async () => {
    const vector = JSON.parse(await readFile(new URL("../test-vectors/vault-v1.json", import.meta.url), "utf8")) as {
      masterPassword: string;
      payload: ReturnType<typeof createEmptyVault>;
      file: Parameters<typeof decryptVault>[1];
    };
    await expect(decryptVault(vector.masterPassword, vector.file)).resolves.toEqual(vector.payload);
  });

  it("round-trips an authenticated vault", async () => {
    const vault = createEmptyVault("Main vault", "test-device", new Date("2026-01-01T00:00:00.000Z"));
    const file = await encryptVault("correct horse battery staple", vault, { kdf: testKdf });
    const reparsed = parseVaultFile(serializeVaultFile(file));
    await expect(decryptVault("correct horse battery staple", reparsed)).resolves.toEqual(vault);
  });

  it("rejects a wrong master password without leaking a cause", async () => {
    const vault = createEmptyVault("Main vault", "test-device");
    const file = await encryptVault("correct horse battery staple", vault, { kdf: testKdf });
    await expect(decryptVault("wrong password", file)).rejects.toBeInstanceOf(VaultAuthenticationError);
  });

  it("rejects authenticated header tampering", async () => {
    const vault = createEmptyVault("Main vault", "test-device");
    const file = await encryptVault("correct horse battery staple", vault, { kdf: testKdf });
    const tampered = { ...file, revision: file.revision + 1 };
    await expect(decryptVault("correct horse battery staple", tampered)).rejects.toBeInstanceOf(VaultAuthenticationError);
  });

  it("decrypts the shared login-mutation interoperability vector", async () => {
    const vector = JSON.parse(await readFile(new URL("../test-vectors/vault-v1-login-crud.json", import.meta.url), "utf8")) as {
      masterPassword: string;
      payload: ReturnType<typeof createEmptyVault>;
      file: Parameters<typeof decryptVault>[1];
    };
    await expect(decryptVault(vector.masterPassword, vector.file)).resolves.toEqual(vector.payload);
  });

  it("re-encrypts a mutation with the retained data key and a fresh payload nonce", async () => {
    const vault = createEmptyVault("Main vault", "test-device", new Date("2026-01-01T00:00:00.000Z"));
    const created = await createUnlockedVault("correct horse battery staple", vault, { kdf: testKdf });
    const updated = addLogin(vault, {
      title: "Example",
      username: "person@example.com",
      password: "secret",
      uris: ["https://example.com/login"],
      androidPackageNames: ["com.example.app"],
    }, { deviceId: "writer-two", now: new Date("2026-01-02T00:00:00.000Z"), itemId: "login-one" });
    const saved = await persistVaultMutation(created.session, updated, async () => undefined);

    expect(saved.payload.nonce).not.toBe(created.file.payload.nonce);
    expect(saved.keyWrap).toEqual(created.file.keyWrap);
    expect(saved.revision).toBe(2);
    expect(await decryptVault("correct horse battery staple", saved)).toEqual(updated);
    created.session.close();
  });

  it("keeps the previous encrypted and unlocked snapshots when persistence fails", async () => {
    const vault = createEmptyVault("Main vault", "test-device", new Date("2026-01-01T00:00:00.000Z"));
    const created = await createUnlockedVault("correct horse battery staple", vault, { kdf: testKdf });
    const updated = addLogin(vault, {
      title: "Example",
      username: "person@example.com",
      password: "secret",
      uris: [],
      androidPackageNames: [],
    }, { deviceId: "test-device", now: new Date("2026-01-02T00:00:00.000Z"), itemId: "login-one" });
    let durableFile = created.file;

    await expect(persistVaultMutation(created.session, updated, async () => {
      throw new Error("disk full");
    })).rejects.toThrow("disk full");

    expect(durableFile.revision).toBe(1);
    expect(created.session.payload).toEqual(vault);
    created.session.close();
  });

  it("persists across lock, serialized restart, and unlock", async () => {
    const vault = createEmptyVault("Main vault", "test-device", new Date("2026-01-01T00:00:00.000Z"));
    const created = await createUnlockedVault("correct horse battery staple", vault, { kdf: testKdf });
    const updated = addLogin(vault, {
      title: "Restart test",
      username: "user",
      password: "secret",
      uris: ["https://example.com"],
      androidPackageNames: [],
    }, { deviceId: "test-device", now: new Date("2026-01-02T00:00:00.000Z"), itemId: "restart-login" });
    let durableFile = created.file;
    await persistVaultMutation(created.session, updated, async (file) => { durableFile = parseVaultFile(serializeVaultFile(file)); });
    created.session.close();

    const restarted = await unlockVault("correct horse battery staple", durableFile);
    expect(restarted.payload.items).toContainEqual(expect.objectContaining({ id: "restart-login" }));
    restarted.close();
  });
});
