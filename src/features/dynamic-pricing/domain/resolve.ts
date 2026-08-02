/**
 * 24 T-4 — the rate-resolution chain (FR-5, AC-6). PURE and deterministic.
 *
 * This is the ONE place the "which rate wins" order lives. 03 (reservations) and
 * 23 (booking-engine) both resolve a nightly rate through `getResolvedRate`
 * (queries.ts), which computes its inputs and delegates the decision here — so
 * direct and web bookings can never diverge on price (glossary.md § rate chain).
 *
 * Fallback order (highest priority first):
 *   1. negotiatedRatePaise — a corporate contract rate the CALLER passes in
 *      (03/23 obtain it from `25.getNegotiatedRate`; 24 never calls 25).
 *   2. dynamicApprovedPaise — the APPROVED `DynamicRate` for (category, date).
 *   3. ratePlanPaise — the category's active rate plan, if any.
 *   4. basePaise — the category's base tariff (`RoomCategory.baseRatePaise`).
 *
 * Booking/search must NEVER fail for a missing dynamic rate: `basePaise` is the
 * always-present floor of the chain, so a resolution always returns a rate.
 */

export type RateSource = "NEGOTIATED" | "DYNAMIC" | "PLAN" | "BASE";

export type ResolveRateInput = {
  /** Corporate-negotiated rate passed in by the caller (25 → 03/23). */
  negotiatedRatePaise?: number | null;
  /** APPROVED DynamicRate.appliedPaise for the (category, date), if any. */
  dynamicApprovedPaise?: number | null;
  /** The category's active RatePlan rate, if any. */
  ratePlanPaise?: number | null;
  /** Always present — the category base tariff. The chain never falls through it. */
  basePaise: number;
};

export type ResolvedRate = { ratePaise: number; source: RateSource };

/**
 * A candidate only counts if it is a positive integer number of paise. A `null`,
 * `undefined`, zero, or negative value is treated as "not set" and the chain
 * falls through to the next source — a zero-rate room is never sold by accident.
 */
function isUsable(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Resolve the winning nightly rate for a (category, date). See file header. */
export function resolveRate(input: ResolveRateInput): ResolvedRate {
  if (isUsable(input.negotiatedRatePaise)) {
    return { ratePaise: input.negotiatedRatePaise, source: "NEGOTIATED" };
  }
  if (isUsable(input.dynamicApprovedPaise)) {
    return { ratePaise: input.dynamicApprovedPaise, source: "DYNAMIC" };
  }
  if (isUsable(input.ratePlanPaise)) {
    return { ratePaise: input.ratePlanPaise, source: "PLAN" };
  }
  return { ratePaise: input.basePaise, source: "BASE" };
}
