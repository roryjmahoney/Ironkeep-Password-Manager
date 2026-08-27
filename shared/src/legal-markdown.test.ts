import { describe, expect, it } from "vitest";
import { parseLegalMarkdown } from "./legal-markdown.js";

describe("legal Markdown", () => {
  it("keeps headings, paragraphs, and wrapped bullets", () => {
    expect(parseLegalMarkdown(`# Document title

**Status:** Effective

## Information handled

- First bullet wraps
  onto another source line.
- Second \`bullet\`.

Read the [privacy notice](PRIVACY.md) now.`)).toEqual([
      { kind: "paragraph", text: "Status: Effective" },
      { kind: "heading", text: "Information handled" },
      { kind: "bullet", text: "First bullet wraps onto another source line." },
      { kind: "bullet", text: "Second bullet." },
      { kind: "paragraph", text: "Read the privacy notice now." },
    ]);
  });

  it("normalizes contact links for readable bundled text", () => {
    expect(parseLegalMarkdown("Contact <https://example.com/privacy>.")).toEqual([
      { kind: "paragraph", text: "Contact https://example.com/privacy." },
    ]);
  });
});
