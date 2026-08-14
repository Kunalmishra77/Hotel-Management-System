/**
 * Add-on / upsell eligibility + lifecycle (Wave 3) — pure, no I/O.
 *
 * A guest may REQUEST an extra while the booking is upcoming (CONFIRMED) or in
 * progress (IN_HOUSE). The folio charge, however, can only be POSTED once the
 * stay is IN_HOUSE — a folio exists only for an active stay (same rule the POS
 * settle path enforces). So a pre-arrival request stays REQUESTED until check-in.
 */
export function canRequestAddOn(reservationStatus: string): boolean {
  return reservationStatus === "CONFIRMED" || reservationStatus === "IN_HOUSE";
}

export function canPostAddOnCharge(reservationStatus: string): boolean {
  return reservationStatus === "IN_HOUSE";
}

/** Forward-only lifecycle: a placed request is accepted (charged) or declined. */
export const ADDON_REQUEST_NEXT: Record<string, readonly string[]> = {
  REQUESTED: ["ACCEPTED", "DECLINED"],
  ACCEPTED: [],
  DECLINED: [],
};

export function canDecide(currentStatus: string, next: string): boolean {
  return (ADDON_REQUEST_NEXT[currentStatus] ?? []).includes(next);
}
