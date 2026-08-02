/**
 * GSTIN validation — 01 T-3 (FR-3, AC-3). Pure domain: no I/O.
 *
 * A GSTIN is 15 characters:
 *   [0-1]   state code (01–38, allotted by the GST council)
 *   [2-11]  the holder's PAN — 5 letters, 4 digits, 1 letter
 *   [12]    entity number for that PAN within the state (1-9, then A-Z)
 *   [13]    'Z' by default
 *   [14]    check digit
 *
 * The check digit matters. A structurally-plausible but invented GSTIN is the
 * common failure mode — someone types their number from memory — and it lands
 * on a GST invoice, which is a statutory document (`compliance.md`). Validating
 * only the shape would let that through.
 */

/** Base-36 alphabet used by the GSTIN checksum. */
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Structural pattern, checked before the checksum so the error can say which
 * kind of wrong it is.
 * State code 01–38 (37 is unassigned but reserved; 38 = Ladakh).
 */
const GSTIN_PATTERN = /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function normalize(gstin: string): string {
  return gstin.trim().toUpperCase().replace(/\s+/g, "");
}

function hasValidStateCode(gstin: string): boolean {
  const code = Number(gstin.slice(0, 2));
  return Number.isInteger(code) && code >= 1 && code <= 38;
}

/**
 * The 15th character, computed from the first 14.
 *
 * Weighted alternating 1,2 across the 14 characters; each product contributes
 * `floor(p/36) + (p % 36)`; the check digit is the base-36 character at
 * `(36 - sum % 36) % 36`.
 */
export function gstinCheckDigit(first14: string): string {
  const value = normalize(first14);
  if (value.length !== 14) {
    throw new Error("gstinCheckDigit expects exactly 14 characters");
  }

  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const index = ALPHABET.indexOf(value[i] as string);
    if (index === -1) return ""; // non-base36 char — cannot be valid
    const product = index * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }

  return ALPHABET[(36 - (sum % 36)) % 36] as string;
}

export function isValidGstin(gstin: string | null | undefined): boolean {
  if (!gstin) return false;
  const value = normalize(gstin);
  if (!GSTIN_PATTERN.test(value)) return false;
  if (!hasValidStateCode(value)) return false;
  return gstinCheckDigit(value.slice(0, 14)) === value[14];
}

export type GstinResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/**
 * Validate an optional GSTIN for a form field (FR-3).
 *
 * Absent is VALID: FR-1 makes `gstin` optional, because not every property is
 * GST-registered. Only a present-but-wrong value is an error.
 */
export function validateGstin(gstin: string | null | undefined): GstinResult {
  if (gstin === null || gstin === undefined || gstin.trim() === "") {
    return { ok: true, value: null };
  }

  const value = normalize(gstin);

  if (value.length !== 15) {
    return { ok: false, error: "A GSTIN must be exactly 15 characters." };
  }
  if (!GSTIN_PATTERN.test(value) || !hasValidStateCode(value)) {
    return {
      ok: false,
      error: "That doesn't look like a GSTIN (expected 2-digit state code, PAN, entity, Z, check digit).",
    };
  }
  if (gstinCheckDigit(value.slice(0, 14)) !== value[14]) {
    return {
      ok: false,
      error: "That GSTIN's check digit doesn't match — please re-check the last character.",
    };
  }

  return { ok: true, value };
}

/**
 * The state code, for GST place-of-supply determination (06 needs this to pick
 * CGST+SGST vs IGST). Returns null rather than a guess when the GSTIN is
 * invalid — a wrong state silently produces a wrong tax split.
 */
export function gstinStateCode(gstin: string | null | undefined): string | null {
  if (!isValidGstin(gstin)) return null;
  return normalize(gstin as string).slice(0, 2);
}
