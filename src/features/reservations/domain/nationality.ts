/**
 * Form C / FRRO applies to FOREIGN nationals only (compliance.md). Nationality is
 * a free-text field, so the SAME guest can read "India", "Indian", "IND", "IN" or
 * blank across flows (manual entry, data-entry backfill, imports). The check-in
 * wizard must recognise every Indian spelling as DOMESTIC — a narrow `=== "india"`
 * test wrongly routed ISO-code guests ("IND") to Form C.
 *
 * Rule: blank → domestic; a known Indian alias → domestic; anything else → foreign.
 * We never guess a country from a city/state, so a stray value errs toward foreign
 * only when it is clearly not one of the Indian forms below.
 */
const INDIAN_ALIASES = new Set([
  "india",
  "indian",
  "ind", // ISO 3166 alpha-3
  "in", // ISO 3166 alpha-2
  "356", // ISO 3166 numeric
  "bharat",
  "bharatiya",
  "hindustan",
  "भारत",
]);

/** True only for an explicitly non-Indian nationality. Blank/Indian → false. */
export function isForeignNationality(nationality: string | null | undefined): boolean {
  const nat = (nationality ?? "").trim().toLowerCase();
  if (nat === "") return false;
  return !INDIAN_ALIASES.has(nat);
}
