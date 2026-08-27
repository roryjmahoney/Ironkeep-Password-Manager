export type LegalBlockKind = "heading" | "paragraph" | "bullet";

export interface LegalBlock {
  kind: LegalBlockKind;
  text: string;
}

export function parseLegalMarkdown(source: string): LegalBlock[] {
  const lines = source.replace(/\r\n/gu, "\n").split("\n");
  const blocks: LegalBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]?.trimEnd() ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("# ")) {
      index += 1;
      continue;
    }

    if (line.startsWith("## ")) {
      blocks.push({ kind: "heading", text: plainLegalText(line.slice(3)) });
      index += 1;
      continue;
    }

    if (line.startsWith("- ")) {
      const parts = [line.slice(2)];
      index += 1;
      while (index < lines.length) {
        const continuation = lines[index] ?? "";
        if (!continuation.trim() || continuation.trimStart().startsWith("- ") || continuation.startsWith("#")) break;
        parts.push(continuation.trim());
        index += 1;
      }
      blocks.push({ kind: "bullet", text: plainLegalText(parts.join(" ")) });
      continue;
    }

    const parts = [line.trim()];
    index += 1;
    while (index < lines.length) {
      const continuation = lines[index] ?? "";
      if (!continuation.trim() || continuation.startsWith("#") || continuation.trimStart().startsWith("- ")) break;
      parts.push(continuation.trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: plainLegalText(parts.join(" ")) });
  }

  return blocks;
}

function plainLegalText(value: string): string {
  return value
    .replace(/\[(.+?)]\([^)]+\)/g, "$1")
    .replace(/<(https?:\/\/[^>]+)>/gu, "$1")
    .replaceAll("**", "")
    .replaceAll("`", "")
    .trim();
}
