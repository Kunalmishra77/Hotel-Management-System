/**
 * `validateRow` — 26 T-4 (FR-3, AC-4/13). Pure domain, no I/O.
 *
 * Per-kind required/type/format validation of ONE raw row (mobile, email,
 * GSTIN, date, amount-in-paise). Returns the ERRORS (with human reasons for the
 * downloadable report) and, when clean, the NORMALISED value the commit path
 * feeds to 04/03/06. Master-data existence (property/category/room) and guest
 * matching are NOT decided here — they need the DB, so the application layer
 * runs them; this layer only judges the row's own shape.
 */
import {
  maskAadhaar,
  normalizeEmail,
  normalizeGstin,
  normalizeMobile,
  normalizeName,
  parseCalendarDate,
  parseRupeesToPaise,
} from "./normalize";

export type ImportKindName = "GUESTS" | "RESERVATIONS" | "BALANCES" | "ROOMS" | "STAFF";

/** The canonical, typed shape produced from a clean raw row. */
export type NormalizedRow = {
  fullName: string | null;
  mobile: string | null;
  email: string | null;
  gstNumber: string | null;
  city: string | null;
  state: string | null;
  companyName: string | null;
  /** Masked last-4 only — the full Aadhaar/scan is never imported (compliance.md). */
  aadhaarMasked: string | null;
  checkInDate: Date | null;
  checkOutDate: Date | null;
  source: string | null;
  categoryName: string | null;
  roomNo: string | null;
  externalRef: string | null;
  amountPaise: number | null;
  adults: number | null;
  children: number | null;
};

export type ValidateResult = { ok: boolean; errors: string[]; normalized: NormalizedRow };

type Raw = Record<string, string | undefined>;

const BOOKING_SOURCES = new Set([
  "DIRECT", "WEBSITE", "PHONE", "WALK_IN",
  "AIRBNB", "BOOKING_COM", "AGODA", "MAKEMYTRIP", "GOIBIBO",
  "CORPORATE", "TRAVEL_AGENT",
]);

/** Trim a cell to a value or null. */
function s(raw: Raw, key: string): string | null {
  const v = raw[key];
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

function baseNormalized(): NormalizedRow {
  return {
    fullName: null, mobile: null, email: null, gstNumber: null, city: null,
    state: null, companyName: null, aadhaarMasked: null, checkInDate: null,
    checkOutDate: null, source: null, categoryName: null, roomNo: null,
    externalRef: null, amountPaise: null, adults: null, children: null,
  };
}

export function validateRow(raw: Raw, kind: ImportKindName): ValidateResult {
  switch (kind) {
    case "GUESTS": return validateGuest(raw);
    case "RESERVATIONS": return validateReservation(raw);
    case "BALANCES": return validateBalance(raw);
    case "ROOMS": return validateRoom(raw);
    case "STAFF": return validateStaff(raw);
    default: {
      const n = baseNormalized();
      return { ok: false, errors: [`Unsupported import kind "${kind}".`], normalized: n };
    }
  }
}

// --- GUESTS -----------------------------------------------------------------
function validateGuest(raw: Raw): ValidateResult {
  const n = baseNormalized();
  const errors: string[] = [];

  n.fullName = normalizeName(s(raw, "fullName")) || null;
  if (!n.fullName) errors.push("Guest name is required.");

  const rawMobile = s(raw, "mobile");
  n.mobile = normalizeMobile(rawMobile);
  if (!rawMobile) errors.push("Mobile number is required.");
  else if (!n.mobile) errors.push("Mobile is not a valid 10-digit Indian number.");

  const rawEmail = s(raw, "email");
  if (rawEmail) {
    n.email = normalizeEmail(rawEmail);
    if (!n.email) errors.push("Email address is not valid.");
  }

  const rawGst = s(raw, "gstNumber");
  if (rawGst) {
    n.gstNumber = normalizeGstin(rawGst);
    if (!n.gstNumber) errors.push("GSTIN format is not valid.");
  }

  n.city = s(raw, "city");
  n.state = s(raw, "state");
  n.companyName = s(raw, "companyName");
  // Aadhaar is masked to last-4 on ingest; the full value is never stored (AC-14).
  n.aadhaarMasked = maskAadhaar(s(raw, "aadhaar"));

  return { ok: errors.length === 0, errors, normalized: n };
}

// --- RESERVATIONS -----------------------------------------------------------
function validateReservation(raw: Raw): ValidateResult {
  const n = baseNormalized();
  const errors: string[] = [];

  const rawMobile = s(raw, "mobile");
  n.mobile = normalizeMobile(rawMobile);
  if (!rawMobile) errors.push("Guest mobile is required to match the booking to a guest.");
  else if (!n.mobile) errors.push("Guest mobile is not a valid 10-digit Indian number.");

  n.checkInDate = parseCalendarDate(s(raw, "checkInDate"));
  if (!n.checkInDate) errors.push("Check-in date is missing or not a valid date.");
  n.checkOutDate = parseCalendarDate(s(raw, "checkOutDate"));
  if (!n.checkOutDate) errors.push("Check-out date is missing or not a valid date.");
  if (n.checkInDate && n.checkOutDate && n.checkOutDate.getTime() < n.checkInDate.getTime()) {
    errors.push("Check-out date is before check-in date.");
  }

  const rawSource = s(raw, "source");
  if (rawSource) {
    const up = rawSource.toUpperCase().replace(/[.\s]+/g, "_");
    if (!BOOKING_SOURCES.has(up)) errors.push(`Unknown booking source "${rawSource}".`);
    else n.source = up;
  }

  n.categoryName = s(raw, "categoryName");
  n.roomNo = s(raw, "roomNo");
  if (!n.categoryName && !n.roomNo) {
    errors.push("A room category or room number is required for a booking.");
  }
  n.externalRef = s(raw, "externalRef");

  const rawAmount = s(raw, "amountPaise") ?? s(raw, "amount");
  if (rawAmount) {
    n.amountPaise = parseRupeesToPaise(rawAmount);
    if (n.amountPaise == null || n.amountPaise < 0) errors.push("Amount is not a valid money value.");
  }
  n.adults = parseCount(s(raw, "adults"));
  n.children = parseCount(s(raw, "children"));

  return { ok: errors.length === 0, errors, normalized: n };
}

// --- BALANCES ---------------------------------------------------------------
function validateBalance(raw: Raw): ValidateResult {
  const n = baseNormalized();
  const errors: string[] = [];

  const rawMobile = s(raw, "mobile");
  n.mobile = normalizeMobile(rawMobile);
  if (!rawMobile) errors.push("Guest mobile is required to attach the balance to a guest.");
  else if (!n.mobile) errors.push("Guest mobile is not a valid 10-digit Indian number.");

  const rawAmount = s(raw, "amount") ?? s(raw, "amountPaise");
  n.amountPaise = parseRupeesToPaise(rawAmount);
  if (rawAmount == null) errors.push("Opening balance amount is required.");
  else if (n.amountPaise == null || n.amountPaise <= 0) errors.push("Amount must be a positive money value.");

  return { ok: errors.length === 0, errors, normalized: n };
}

// --- ROOMS / STAFF (master data) --------------------------------------------
function validateRoom(raw: Raw): ValidateResult {
  const n = baseNormalized();
  const errors: string[] = [];
  n.roomNo = s(raw, "roomNo");
  if (!n.roomNo) errors.push("Room number is required.");
  n.categoryName = s(raw, "categoryName");
  if (!n.categoryName) errors.push("Room category is required.");
  return { ok: errors.length === 0, errors, normalized: n };
}

function validateStaff(raw: Raw): ValidateResult {
  const n = baseNormalized();
  const errors: string[] = [];
  n.fullName = normalizeName(s(raw, "fullName")) || null;
  if (!n.fullName) errors.push("Staff name is required.");
  n.mobile = normalizeMobile(s(raw, "mobile"));
  return { ok: errors.length === 0, errors, normalized: n };
}

function parseCount(v: string | null): number | null {
  if (v == null) return null;
  const num = Number(v.replace(/\D/g, ""));
  return Number.isFinite(num) && num >= 0 ? num : null;
}
