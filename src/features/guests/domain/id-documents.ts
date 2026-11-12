/**
 * Which images each ID document needs (client, 11–12 Nov 2026). One rule, used
 * by every place that captures an ID (check-in wizard, guest profile, the
 * booking's pending card) AND re-checked on the server, so no form can skip it:
 *  - the FRONT is always required; the BACK is always optional (12 Nov: "back
 *    side optional ho, sirf front mandatory");
 *  - Aadhaar, Driving licence, Voter ID show a back slot (the address / validity
 *    is on the reverse) so it's one tap to add;
 *  - Passport (photo page), PAN, Visa → one side;
 *  - Other document → its NAME is required ("Company ID", "Student ID",
 *    "Arms licence"…), front required, back optional for two-sided cards.
 * A typed number stays optional — the images are the record.
 */
export type IdDocType = "AADHAAR" | "PASSPORT" | "DRIVING_LICENCE" | "PAN" | "VOTER_ID" | "VISA" | "OTHER";

type DocRule = { label: string; front: string; back?: string; backRequired: boolean; needsName: boolean };

export const ID_DOC_RULES: Record<IdDocType, DocRule> = {
  AADHAAR: { label: "Aadhaar", front: "Aadhaar — front", back: "Aadhaar — back (optional)", backRequired: false, needsName: false },
  DRIVING_LICENCE: { label: "Driving licence", front: "Driving licence — front", back: "Driving licence — back (optional)", backRequired: false, needsName: false },
  VOTER_ID: { label: "Voter ID", front: "Voter ID — front", back: "Voter ID — back (optional)", backRequired: false, needsName: false },
  PASSPORT: { label: "Passport", front: "Passport — photo page", backRequired: false, needsName: false },
  PAN: { label: "PAN", front: "PAN — front", backRequired: false, needsName: false },
  VISA: { label: "Visa", front: "Visa — page", backRequired: false, needsName: false },
  OTHER: { label: "Other document", front: "Document — front", back: "Document — back (optional)", backRequired: false, needsName: true },
};

/** Picker order: the three two-sided cards first (the common ones), then the rest. */
export const ID_DOC_TYPES: { value: IdDocType; label: string }[] = (
  ["AADHAAR", "DRIVING_LICENCE", "VOTER_ID", "PASSPORT", "PAN", "VISA", "OTHER"] as const
).map((value) => ({ value, label: ID_DOC_RULES[value].label }));

export const docRule = (type: string): DocRule => ID_DOC_RULES[type as IdDocType] ?? ID_DOC_RULES.OTHER;

/** What a captured ID is called on screen: the document's own name for "Other". */
export const idDisplayName = (type: string, documentName?: string | null): string =>
  type === "OTHER" && documentName?.trim() ? documentName.trim() : docRule(type).label;

/** Why this capture can't be saved yet, or null when it is complete. */
export function idDocumentProblem(input: { type: string; hasFront: boolean; hasBack: boolean; documentName?: string | null }): string | null {
  const rule = docRule(input.type);
  if (rule.needsName && !input.documentName?.trim()) return "Enter the document's name (e.g. Company ID, Student ID).";
  if (!input.hasFront && !input.hasBack) return rule.back ? `Upload the front of the ${rule.label} (the back is optional).` : `Upload the ${rule.label} image.`;
  if (!input.hasFront) return `Upload the front of the ${rule.label}.`;
  if (rule.backRequired && !input.hasBack) return `Upload the back of the ${rule.label} too — both sides are needed.`;
  return null;
}
