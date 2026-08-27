import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pairs = [
  ["docs/PRIVACY.md", "android/app/src/main/assets/legal/PRIVACY.md"],
  ["docs/TERMS.md", "android/app/src/main/assets/legal/TERMS.md"],
];

function normalized(relativePath) {
  return readFileSync(path.join(repositoryRoot, relativePath), "utf8").replace(/\r\n/gu, "\n").trimEnd();
}

for (const [canonicalPath, androidPath] of pairs) {
  if (normalized(canonicalPath) !== normalized(androidPath)) {
    throw new Error(`${androidPath} must exactly match ${canonicalPath}`);
  }
}

const privacy = normalized("docs/PRIVACY.md");
const terms = normalized("docs/TERMS.md");
if (!privacy.startsWith("# Ironkeep Privacy Notice")) throw new Error("Privacy notice title is missing");
if (!terms.startsWith("# Ironkeep Terms of Use")) throw new Error("Terms title is missing");

console.log("Legal document mirrors verified.");
