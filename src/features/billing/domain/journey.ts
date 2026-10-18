/**
 * Outstanding across a guest's stays — 06 (FR-18/24).
 *
 * A guest's dues are the SUM OF POSITIVE folio balances, not the net: one stay
 * that was overpaid must never mask another stay that still owes. That rule is
 * right between unrelated stays and wrong inside a single one.
 *
 * A stay split across linked bookings is still ONE stay. A mid-stay transfer to
 * another property, or an OTA stay continuing direct, is billed on a folio per
 * property — by design, so each property's books and GST stand alone — and the
 * guest settles it against ONE combined statement. Payment usually lands whole on
 * whichever folio was in front of the cashier, so the earlier leg sits in credit
 * while the later leg shows a due. Summing only the positives then reports a
 * guest as owing money they have already paid: Ankit Bansal read ₹2,205
 * outstanding on a journey he had overpaid by ₹1,890.
 *
 * So: net WITHIN a journey (the `transferredFromId` chain), sum positives ACROSS
 * journeys. Pure, so the rule has one definition and a test.
 */
export type JourneyFolio = {
  reservationId: string;
  /** The booking this one continues, when it is a linked leg. */
  transferredFromId: string | null;
  /** Charges + tax − payments for this leg; negative when in credit. */
  balancePaise: bigint;
};

/**
 * The root of `id`'s chain, following `transferredFromId` upward. A parent
 * outside the set (another guest's booking, or one not loaded) ends the walk —
 * only legs we can actually see are netted together. Cycles cannot occur through
 * the app, but the visited set keeps a corrupt row from hanging the caller.
 */
function journeyRoot(id: string, parentOf: Map<string, string | null>): string {
  const seen = new Set<string>();
  let cur = id;
  for (;;) {
    if (seen.has(cur)) return cur;
    seen.add(cur);
    const parent = parentOf.get(cur);
    if (!parent || !parentOf.has(parent)) return cur;
    cur = parent;
  }
}

/** Net balance per journey, keyed by the journey's root booking. */
export function journeyBalances(folios: readonly JourneyFolio[]): Map<string, bigint> {
  const parentOf = new Map(folios.map((f) => [f.reservationId, f.transferredFromId]));
  const out = new Map<string, bigint>();
  for (const f of folios) {
    const root = journeyRoot(f.reservationId, parentOf);
    out.set(root, (out.get(root) ?? 0n) + f.balancePaise);
  }
  return out;
}

/** What the guest still owes: Σ of each JOURNEY's positive net balance. */
export function outstandingAcrossJourneys(folios: readonly JourneyFolio[]): bigint {
  let total = 0n;
  for (const net of journeyBalances(folios).values()) {
    if (net > 0n) total += net;
  }
  return total;
}
