/**
 * 18 T-10 — prompt & log redaction (FR-9, AC-11).
 *
 * PII minimization is enforced in CODE, not by asking the model nicely: every
 * string that reaches a provider — or lands in `AiInteractionLog.inputRedacted`
 * — passes through here first. We strip the *values* that must never leave the
 * property (Aadhaar, other government IDs, phone, email, card/account numbers,
 * explicit money amounts). The words themselves may remain; it is the sensitive
 * data that is removed (compliance.md).
 *
 * This is a value-scrubber, not a classifier: it errs toward over-redaction. A
 * false positive costs the model a little context; a false negative leaks PII.
 */

/**
 * Ordered so the most specific / longest patterns win before broader digit runs.
 * GSTIN and email are matched before the naked-digit rules so they aren't partly
 * eaten; Aadhaar (exactly 12 digits, grouped or not) is caught as ONE unit before
 * the shorter phone rule can nibble at it.
 */
const RULES: { label: string; re: RegExp }[] = [
  // GSTIN: 15-char (contains digits + letters; match before plain-digit rules).
  { label: "[REDACTED_GSTIN]", re: /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]{2}\b/g },
  // Email.
  { label: "[REDACTED_EMAIL]", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // PAN: ABCDE1234F.
  { label: "[REDACTED_PAN]", re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  // Passport (India): 1 letter + 7 digits.
  { label: "[REDACTED_PASSPORT]", re: /\b[A-PR-WY][0-9]{7}\b/g },
  // Masked Aadhaar: "XXXX XXXX 9012".
  { label: "[REDACTED_AADHAAR]", re: /\b(?:[xX*]{4}[\s-]?){1,2}\d{4}\b/g },
  // Aadhaar: exactly 12 digits, optionally grouped 4-4-4 — as ONE unit.
  { label: "[REDACTED_AADHAAR]", re: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g },
  // Card / account: 13–19 digit runs (12-digit runs are Aadhaar, handled above).
  { label: "[REDACTED_CARD]", re: /\b(?:\d[\s-]?){13,19}\b/g },
  // Indian mobile: optional +91, 10 digits starting 6-9.
  { label: "[REDACTED_PHONE]", re: /(?:\+?91[\s-]?)?\b[6-9]\d{9}\b/g },
  // Explicit rupee amounts — money detail beyond need (FR-9).
  { label: "[REDACTED_AMOUNT]", re: /(?:₹|Rs\.?|INR)\s?\d[\d,]*(?:\.\d+)?/gi },
];

/** Redact PII values from a free-text string before it reaches a provider or a log. */
export function redactText(input: string): string {
  let out = input;
  for (const { label, re } of RULES) out = out.replace(re, label);
  return out;
}

/**
 * Deep-redact an arbitrary value for `AiInteractionLog.inputRedacted`. Strings
 * are scrubbed; keys whose name signals PII are dropped entirely so a raw value
 * cannot survive under a telltale key.
 */
const PII_KEY = /aadhaar|passport|mobile|phone|whatsapp|email|dob|address|pan|gstin|card|account|bank/i;

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PII_KEY.test(k)) {
        out[k] = "[REDACTED]";
        continue;
      }
      out[k] = redactValue(v, depth + 1);
    }
    return out;
  }
  return null;
}
