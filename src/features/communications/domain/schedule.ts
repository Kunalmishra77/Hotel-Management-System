/**
 * dueScheduledSends — 12 T-7 (FR-13, AC-11). PURE.
 *
 * A scheduled automation has a `scheduleOffsetMinutes` relative to a reservation
 * anchor (check-in for before-arrival, check-out for after-checkout). A send is
 * due when `anchor + offset <= now`. Idempotency is by construction: reservations
 * already sent (passed in `alreadySent`) are excluded, so re-running the tick
 * never produces a second send for the same (reservation, automation).
 */

export type ScheduleCandidate = {
  reservationId: string;
  guestId: string;
  /** The instant the offset is measured from (property-local anchor as a UTC instant). */
  anchor: Date;
};

export type DueSend = { reservationId: string; guestId: string; dueAt: Date };

export function dueScheduledSends(input: {
  reservations: readonly ScheduleCandidate[];
  offsetMinutes: number;
  now: Date;
  alreadySent?: ReadonlySet<string>;
}): DueSend[] {
  const { reservations, offsetMinutes, now, alreadySent } = input;
  const out: DueSend[] = [];
  for (const r of reservations) {
    if (alreadySent?.has(r.reservationId)) continue; // idempotent (FR-13)
    const dueAt = new Date(r.anchor.getTime() + offsetMinutes * 60_000);
    if (dueAt.getTime() <= now.getTime()) out.push({ reservationId: r.reservationId, guestId: r.guestId, dueAt });
  }
  return out;
}
