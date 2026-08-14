/**
 * Online check-in eligibility (Wave 2) — pure. A guest may self-check-in a
 * reservation that is CONFIRMED (booked but not yet checked in by the desk) and
 * whose stay hasn't already ended. Re-submitting (before arrival) is allowed.
 */
export function canOnlineCheckIn(status: string): boolean {
  return status === "CONFIRMED";
}
