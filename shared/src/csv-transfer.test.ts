import { describe, expect, it } from "vitest";
import { createEmptyVault } from "./models.js";
import { addLogin } from "./vault-mutations.js";
import { applyVaultCsvImport, exportVaultCsv, previewVaultCsvImport } from "./csv-transfer.js";

describe("CSV transfer", () => {
  it("round-trips quoted login data", () => {
    const original = addLogin(
      createEmptyVault("Test", "device-a", new Date("2026-01-01T00:00:00.000Z")),
      { title: "Example, Inc.", username: "person@example.com", password: "p@ss,word", uris: ["https://example.com"], androidPackageNames: [] },
      { deviceId: "device-a" },
    );
    const parsed = previewVaultCsvImport(createEmptyVault("Empty", "device-b"), exportVaultCsv(original));
    const imported = applyVaultCsvImport(createEmptyVault("Empty", "device-b"), parsed.records, false, { deviceId: "device-b" });
    expect(parsed.preview).toEqual({ totalRows: 1, validRows: 1, duplicateRows: 0, invalidRows: 0 });
    expect(imported.items[0]).toMatchObject({ title: "Example, Inc.", username: "person@example.com", password: "p@ss,word" });
  });

  it("previews common browser CSV and skips duplicates by default", () => {
    const payload = addLogin(
      createEmptyVault("Test", "device-a"),
      { title: "Example", username: "person@example.com", password: "secret", uris: ["https://example.com"], androidPackageNames: [] },
      { deviceId: "device-a" },
    );
    const parsed = previewVaultCsvImport(payload, "name,url,username,password\r\nExample,https://example.com,person@example.com,secret\r\nNew,https://new.example,new@example.com,new-secret\r\n");
    const imported = applyVaultCsvImport(payload, parsed.records, false, { deviceId: "device-a" });
    expect(parsed.preview.duplicateRows).toBe(1);
    expect(imported.items).toHaveLength(2);
  });

  it("derives a safe title for Firefox-style CSV without a name column", () => {
    const parsed = previewVaultCsvImport(
      createEmptyVault("Test", "device-a"),
      "url,username,password,httpRealm\r\nhttps://accounts.example.test/login,person@example.test,secret,\r\n",
    );
    expect(parsed.records[0]?.record).toMatchObject({ kind: "login", fields: { title: "accounts.example.test" } });
  });
});
