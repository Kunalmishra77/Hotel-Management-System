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
  if (!input.maskedEmail) items.push({ key: "email", label: "Email address (for the bill)", required: false });

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
