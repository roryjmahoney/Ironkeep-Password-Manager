import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createEmptyVault } from "./models.js";
import { decryptVault, encryptVault, parseVaultFile, serializeVaultFile, VaultAuthenticationError } from "./crypto.js";

const testKdf = { memoryKiB: 19 * 1024, iterations: 2, parallelism: 1 } as const;

describe("Ironkeep vault envelope", () => {
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
});
