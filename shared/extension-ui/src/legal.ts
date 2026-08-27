import privacyNotice from "../../../docs/PRIVACY.md?raw";
import termsOfUse from "../../../docs/TERMS.md?raw";
export { parseLegalMarkdown } from "@ironkeep/shared";

export type LegalDocumentKind = "privacy" | "terms";

export const LEGAL_DOCUMENTS: Record<LegalDocumentKind, { title: string; source: string }> = {
  privacy: { title: "Privacy notice", source: privacyNotice },
  terms: { title: "Terms of use", source: termsOfUse },
};
