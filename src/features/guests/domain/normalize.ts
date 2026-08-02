/**
 * Contact normalisation — 04 T-4 (FR-5/FR-6/FR-10). Pure domain.
 *
 * Everything that dedupes or searches on a contact goes through here first.
 * "+91 98765 43210", "098765 43210" and "9876543210" are one person; if they
 * normalise differently, FR-5's duplicate check silently misses them and the
 * hotel ends up with two records for the same guest.
 *
 * The normalised value is what gets keyed-hashed into `mobileHash`/`emailHash`,
 * so a change here invalidates existing search tokens — treat it as a data
 * migration, not a tweak.
 */

/** India: 10 digits, first digit 6-9 (TRAI allocation). */
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/**
 * Deliberately permissive. Full RFC 5322 is famously unmatchable, and an
 * over-strict pattern rejects real addresses — which for a hotel means turning
 * away a booking. Delivery failures are handled by 12, not guessed at here.
 */
const EMAIL = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

/**
 * Reduce an Indian mobile to its 10 significant digits, or null.
 *
 * Handles the country code written as `+91`, `0091`, `91`, and the domestic
 * trunk `0` prefix, plus any spacing/punctuation.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;

  let digits = input.replace(/\D/g, "");
  if (digits.length === 0) return null;

  // Strip the country code in its various written forms, then the trunk 0.
  if (digits.length === 14 && digits.startsWith("0091")) digits = digits.slice(4);
  else if (digits.length === 13 && digits.startsWith("091")) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  return INDIAN_MOBILE.test(digits) ? digits : null;
}

export function isValidIndianMobile(input: string | null | undefined): boolean {
  if (!input) return false;
  return INDIAN_MOBILE.test(input.replace(/\D/g, ""));
}

/**
 * Lowercase + trim only.
 *
 * Deliberately does NOT strip Gmail dots or `+tags`: only some providers treat
 * those as equivalent, so folding them would merge two genuinely different
 * people. A missed duplicate is recoverable (staff merge it); a wrongly merged
 * guest means one person seeing another's stay history.
 */
export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  if (value === "" || !EMAIL.test(value)) return null;
  return value;
}

export function normalizeGstin(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.replace(/\s/g, "").toUpperCase();
  return value === "" ? null : value;
}

/** Collapse internal whitespace so "Ravi   Kumar" matches "Ravi Kumar". */
export function normalizeName(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}
