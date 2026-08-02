/**
 * Guest-history derivation — 05 T-3/T-4 (FR-1/6, AC-1/2/7/12). Pure: the single
 * definition of a guest's stats. Revenue/outstanding come from 06's
 * `guestBilling` roll-up (net-of-discount, tax-excluded — so 05 reconciles with
 * 06/14 to the paisa); visits/room-nights/preferences derive from 03's
 * reservations. Cancelled and no-show reservations never count (AC-12).
 */
export type HistoryReservation = {
  status: string;
  nights: number;
  ratePaise: number;
  checkOutAt: Date | null;
  checkInDate: Date;
  categoryId: string | null;
};

export type GuestBillingRollup = { revenuePaise: number; outstandingPaise: number };

export type GuestStats = {
  visits: number;
  totalRoomNights: number;
  totalRevenuePaise: number;
  outstandingPaise: number;
  preferredCategoryId: string | null;
  preferredRatePaise: number | null;
  lastStayAt: Date | null;
};

/** A stay that actually happened — completed or in progress; never cancelled/no-show. */
function isRealStay(status: string): boolean {
  return status === "CHECKED_OUT" || status === "IN_HOUSE";
}

/** Mode (most frequent) of a list; ties broken by first-seen. Null when empty. */
function mode<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  let best: T | null = null;
  let bestCount = 0;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > bestCount) { best = v; bestCount = n; }
  }
  return best;
}

export function preferredCategory(reservations: HistoryReservation[]): string | null {
  return mode(reservations.filter((r) => isRealStay(r.status) && r.categoryId).map((r) => r.categoryId as string));
}

export function preferredRate(reservations: HistoryReservation[]): number | null {
  return mode(reservations.filter((r) => isRealStay(r.status)).map((r) => r.ratePaise));
}

export function deriveStats(
  reservations: HistoryReservation[],
  billing: GuestBillingRollup,
): GuestStats {
  const stays = reservations.filter((r) => isRealStay(r.status));
  const lastStayAt = stays.reduce<Date | null>((latest, r) => {
    const when = r.checkOutAt ?? r.checkInDate;
    return !latest || when > latest ? when : latest;
  }, null);

  return {
    visits: stays.length,
    totalRoomNights: stays.reduce((sum, r) => sum + r.nights, 0),
    // Money is authoritative from 06 — never re-summed here.
    totalRevenuePaise: billing.revenuePaise,
    outstandingPaise: billing.outstandingPaise,
    preferredCategoryId: preferredCategory(reservations),
    preferredRatePaise: preferredRate(reservations),
    lastStayAt,
  };
}
