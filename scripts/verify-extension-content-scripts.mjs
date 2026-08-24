import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const extensionRoots = ["extensions/chromium/dist", "extensions/firefox/dist"];
const moduleSyntax = /(^|[;}])\s*(?:import\s*(?:[({*]|["'])|export\s)/m;

for (const root of extensionRoots) {
  const manifestPath = resolve(root, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const scripts = manifest.content_scripts?.flatMap((entry) => entry.js ?? []) ?? [];

  if (!scripts.length) throw new Error(`${root}: manifest has no content scripts`);

  for (const script of scripts) {
    const source = await readFile(resolve(root, script), "utf8");
    if (moduleSyntax.test(source)) {
      throw new Error(`${root}/${script}: manifest content scripts must not contain ES module syntax`);
    }
  }
}

console.log("Verified extension content scripts are standalone classic scripts.");
