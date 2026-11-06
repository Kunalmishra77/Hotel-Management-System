/**
 * Pending guest-information checklist (client req #6) — a pure derivation of what
 * is still missing on a booking's guest, so reception can collect it at check-in
 * and before checkout. Nothing is stored: "pending" is computed from the guest
 * record + folio balance every time, so it can never drift out of date.
 */

export type ChecklistInput = {
  maskedMobile: string | null;
  maskedEmail: string | null;
  companyName: string | null;
  gstNumber: string | null;
  addressLine: string | null;
  ids: { hasScan: boolean }[];
  balancePaise: number | null;
  /** Check-in details (client, 5 Nov 2026). Omitted by callers that don't track them. */
  hasWhatsapp?: boolean;
  dob?: string | null;
  gender?: string | null;
  nationality?: string | null;
};

export type ChecklistItem = {
  key: string;
  label: string;
  /** true = must be collected (blocks a clean checkout); false = nice-to-have. */
  required: boolean;
};

/**
 * The still-missing items for a guest, most-important first. An empty array means
 * the guest record is complete for billing + compliance purposes.
 */
export function pendingGuestInfo(input: ChecklistInput): ChecklistItem[] {
  const items: ChecklistItem[] = [];

  if (!input.maskedMobile) items.push({ key: "mobile", label: "Contact number", required: true });
  if (input.hasWhatsapp === false) items.push({ key: "whatsapp", label: "WhatsApp number", required: true });
  if (!input.maskedEmail) items.push({ key: "email", label: "Email address (for the bill)", required: false });
  if (input.dob === null) items.push({ key: "dob", label: "Date of birth", required: false });
  if (input.gender === null) items.push({ key: "gender", label: "Gender", required: true });
  if (input.nationality === null) items.push({ key: "nationality", label: "Nationality", required: true });

  const hasAnyId = input.ids.length > 0;
  const hasAnyScan = input.ids.some((i) => i.hasScan);
  if (!hasAnyId) items.push({ key: "id", label: "Photo ID (Aadhaar / passport / DL)", required: true });
  else if (!hasAnyScan) items.push({ key: "id-scan", label: "ID document scan / photo", required: true });

  // GSTIN only matters when the stay is billed to a company (GST input credit).
  if (input.companyName && !input.gstNumber) {
    items.push({ key: "gstin", label: "Company GSTIN", required: false });
  }

  if (!input.addressLine) items.push({ key: "address", label: "Billing address", required: false });

  if (input.balancePaise !== null && input.balancePaise > 0) {
    items.push({ key: "balance", label: "Outstanding balance to settle", required: true });
  }

  return items;
}

/**
 * What the guest record still lacks before CHECK-IN (client, 5 Nov 2026): a
 * booking needs only name + mobile + address, but check-in collects everything.
 * Mandatory: mobile, WhatsApp, gender, nationality, home address (street, city,
 * country) and at least one ID. Email and date of birth are NOT required here —
 * when skipped they stay on the booking's "Pending information" card.
 *
 * RETURNING guests (client, 6 Nov 2026): someone who has stayed before was
 * checked in under the older, shorter form — re-asking everything at the desk
 * is exactly what the client doesn't want. For them only the photo ID is
 * required (as it always was); anything else their record lacks goes to the
 * booking's pending card instead of blocking. Only a FIRST-TIME guest must
 * complete the full record to check in.
 */
export type CheckInGuest = {
  hasMobile: boolean;
  hasWhatsapp: boolean;
  gender: string | null;
  nationality: string | null;
  addressLine: string | null;
  city: string | null;
  country: string | null;
  idCount: number;
  /** Has an earlier stay (in-house or checked-out) — see the note above. */
  returning?: boolean;
};

export function missingForCheckIn(g: CheckInGuest): string[] {
  const blank = (v: string | null) => !v || v.trim() === "";
  const missing: string[] = [];
  if (g.returning) return g.idCount === 0 ? ["a photo ID"] : [];
  if (!g.hasMobile) missing.push("mobile number");
  if (!g.hasWhatsapp) missing.push("WhatsApp number");
  if (blank(g.gender)) missing.push("gender");
  if (blank(g.nationality)) missing.push("nationality");
  if (blank(g.addressLine)) missing.push("home address");
  if (blank(g.city)) missing.push("city");
  if (blank(g.country)) missing.push("country");
  if (g.idCount === 0) missing.push("a photo ID");
  return missing;
}
