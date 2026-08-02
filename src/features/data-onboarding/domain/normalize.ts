/**
 * Import-side field normalisation — 26 (pure domain).
 *
 * Deliberately self-contained (a small re-implementation of the guest
 * normalisers) rather than a deep import into 04's `domain/normalize` — a module
 * may only reach another module through its public surface (architecture.md).
 * The values produced here feed 04's public `searchGuests`/`createGuest`, which
 * re-normalise with the SAME rules, so the two never disagree on identity.
 */

/** India: 10 significant digits, first digit 6-9 (TRAI allocation). */
const INDIAN_MOBILE = /^[6-9]\d{9}$/;
const EMAIL = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;
/** 15-char GSTIN: 2-digit state, PAN, entity, Z, checksum. */
const GSTIN = /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * Reduce an Indian mobile to its 10 significant digits, or null. Strips `+91`,
 * `0091`, `91` and the trunk `0`, plus any spacing/punctuation — the same forms
 * 04 accepts, so "+91 98765 43210" and "9876543210" import as one guest.
 */
export function normalizeMobile(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = input.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.length === 14 && digits.startsWith("0091")) digits = digits.slice(4);
  else if (digits.length === 13 && digits.startsWith("091")) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return INDIAN_MOBILE.test(digits) ? digits : null;
}

export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  return value !== "" && EMAIL.test(value) ? value : null;
}

export function normalizeGstin(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.replace(/\s/g, "").toUpperCase();
  return GSTIN.test(value) ? value : null;
}

/**
 * Parse a money field to integer paise. Accepts "1234.50", "₹1,234.50",
 * "1234" (rupees) — the human forms a go-live spreadsheet actually contains.
 * Returns null on anything non-numeric. Rounds half-up at the paisa
 * (data-model.md); the value is small and bounded, so plain integer math is safe.
 */
export function parseRupeesToPaise(input: string | null | undefined): number | null {
  if (input == null) return null;
  const cleaned = String(input).replace(/[₹,\s]/g, "").trim();
  if (cleaned === "" || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const rupees = Number(cleaned);
  if (!Number.isFinite(rupees)) return null;
  return Math.round(rupees * 100);
}

/**
 * Parse a calendar date (a `@db.Date`-style, time-zone-free day). Accepts
 * ISO `YYYY-MM-DD` and the common Indian `DD/MM/YYYY` / `DD-MM-YYYY`. Returns a
 * UTC-midnight Date, or null. Kept strict — a wrong guess on a stay date
 * silently corrupts guest history.
 */
export function parseCalendarDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const s = input.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return utcDate(+iso[1]!, +iso[2]!, +iso[3]!);
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (dmy) return utcDate(+dmy[3]!, +dmy[2]!, +dmy[1]!);
  return null;
}

function utcDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Reject overflow (e.g. 31/02 → 03 March).
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

/** Mask an Aadhaar to its last 4 digits (compliance.md — masked by default). */
export function maskAadhaar(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `XXXX-XXXX-${digits.slice(-4)}`;
}

/** Collapse internal whitespace so "Ravi   Kumar" == "Ravi Kumar". */
export function normalizeName(input: string | null | undefined): string {
  return (input ?? "").trim().replace(/\s+/g, " ");
}
