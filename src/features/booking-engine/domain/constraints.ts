/**
 * validateStayConstraints — 23 T-4 (FR-14, AC-14). Pure: reject a requested
 * stay that breaks the property's online-booking rules BEFORE anything persists.
 *
 * Checks (from BookingEngineConfig): minimum / maximum length-of-stay, lead-time
 * window (how far ahead a public guest may book), max rooms per booking, and
 * occupancy against the category maximum (an extra bed relaxes the adult cap by
 * one where the property allows it).
 *
 * Returns a Result rather than throwing so the caller decides the error surface;
 * the route/orchestration maps a failure to STAY_CONSTRAINT_VIOLATION.
 */

export type StayConstraintConfig = {
  minLos: number;
  maxLos: number | null;
  leadTimeDays: number;
  maxRoomsPerBooking: number;
};

export type StayConstraintInput = {
  nights: number;
  /** Whole days from "today" (property-local) to check-in; 0 = same-day. */
  leadDays: number;
  rooms: number;
  adults: number;
  children: number;
  extraBed: boolean;
  category: { maxAdults: number; maxChildren: number };
};

export type ConstraintResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateStayConstraints(
  input: StayConstraintInput,
  cfg: StayConstraintConfig,
): ConstraintResult {
  if (input.nights < cfg.minLos) {
    return { ok: false, reason: `A minimum stay of ${cfg.minLos} night(s) is required.` };
  }
  if (cfg.maxLos != null && input.nights > cfg.maxLos) {
    return { ok: false, reason: `The maximum stay online is ${cfg.maxLos} night(s).` };
  }
  // Lead time: a booking must start at least `leadTimeDays` ahead. A negative
  // leadDays (check-in already in the past) is always rejected.
  if (input.leadDays < cfg.leadTimeDays) {
    return {
      ok: false,
      reason:
        cfg.leadTimeDays > 0
          ? `Bookings must be made at least ${cfg.leadTimeDays} day(s) in advance.`
          : "Check-in date is in the past.",
    };
  }
  if (input.rooms < 1 || input.rooms > cfg.maxRoomsPerBooking) {
    return { ok: false, reason: `Between 1 and ${cfg.maxRoomsPerBooking} room(s) per booking.` };
  }
  // Occupancy: an extra bed (where offered) permits one adult over the cap.
  const adultCap = input.category.maxAdults + (input.extraBed ? 1 : 0);
  if (input.adults < 1 || input.adults > adultCap) {
    return { ok: false, reason: "That's more guests than this room allows." };
  }
  if (input.children < 0 || input.children > input.category.maxChildren) {
    return { ok: false, reason: "That's more children than this room allows." };
  }
  return { ok: true };
}
