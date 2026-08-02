/**
 * Reservation state machine — 03 T-7 (FR-11, AC-18).
 *
 * The single authority for legal status changes (design.md § State machine).
 * Any edge not drawn here is rejected — including self-loops (a room move keeps
 * status IN_HOUSE but is a *different* action that never calls this) and
 * "skip-ahead" edges like ENQUIRY→IN_HOUSE or CONFIRMED→CHECKED_OUT.
 *
 *   ENQUIRY   → CONFIRMED (confirm) | CANCELLED (expire/cancel)
 *   CONFIRMED → IN_HOUSE (check-in) | CANCELLED (cancel) | NO_SHOW (night audit)
 *   IN_HOUSE  → CHECKED_OUT (check-out)
 *   CHECKED_OUT / CANCELLED / NO_SHOW → (terminal)
 */
import type { ReservationStatus } from "@prisma/client";

const ALLOWED: Record<ReservationStatus, readonly ReservationStatus[]> = {
  ENQUIRY: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["IN_HOUSE", "CANCELLED", "NO_SHOW"],
  IN_HOUSE: ["CHECKED_OUT"],
  CHECKED_OUT: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function canTransition(from: ReservationStatus, to: ReservationStatus): boolean {
  return ALLOWED[from].includes(to);
}
