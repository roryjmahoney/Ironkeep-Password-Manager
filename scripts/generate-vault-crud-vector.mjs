import { readFile, writeFile } from "node:fs/promises";
import { addLogin, unlockVault } from "../shared/dist/index.js";

const sourceUrl = new URL("../shared/test-vectors/vault-v1.json", import.meta.url);
const outputUrl = new URL("../shared/test-vectors/vault-v1-login-crud.json", import.meta.url);
const source = JSON.parse(await readFile(sourceUrl, "utf8"));
const session = await unlockVault(source.masterPassword, source.file);

try {
  const payload = addLogin(session.payload, {
    title: "Ironkeep compatibility login",
    username: "vector@example.com",
    password: "vector-password-only",
    uris: ["https://example.com/login"],
    androidPackageNames: ["com.example.vector"],
  }, {
    deviceId: "vector-device-two",
    now: new Date("2026-08-24T00:00:00.000Z"),
    itemId: "00000000-0000-4000-8000-000000000101",
  });
  const file = await session.encryptPayload(payload, {
    payloadNonce: Uint8Array.from([33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44]),
  });
  await writeFile(outputUrl, `${JSON.stringify({ masterPassword: source.masterPassword, payload, file }, null, 2)}\n`, "utf8");
} finally {
  session.close();
}
