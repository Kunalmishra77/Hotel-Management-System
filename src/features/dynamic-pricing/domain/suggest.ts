/**
 * 24 T-3 — rate-SUGGESTION math + guardrail helpers (FR-1/3, AC-1/2/7/8). PURE
 * and deterministic; all money is integer paise, arithmetic via Decimal.js.
 *
 * An occupancy / season / lead-time model that nudges the category base rate up
 * under demand and down when soft, then CLAMPS the result to the category's
 * [floor, ceil] guardrail. A clamped suggestion is FLAGGED (`clamped: true`) so
 * the approval screen can show it was pulled into bounds — an out-of-bounds rate
 * is never produced (AC-2/AC-7).
 *
 * This mirrors 18's `suggestRateForDate` (which 24 calls when AI is enabled);
 * it is 24's own deterministic fallback used when 18 is unavailable or occupancy
 * data is missing (AC-8: fall back to base, never crash / divide-by-zero).
 */
import Decimal from "decimal.js";

export type SuggestRateInput = {
  basePaise: number;
  /** Occupancy for the stay date in basis points (0..10000). */
  occupancyBps: number;
  /** Days between "now" and the stay date (>= 0). */
  leadTimeDays: number;
  /** True for a configured seasonal peak. */
  isPeakSeason: boolean;
  /** Category guardrails; null ⇒ that side is unbounded. */
  floorPaise?: number | null;
  ceilPaise?: number | null;
};

export type SuggestedRate = {
  suggestedPaise: number;
  /** True when the raw suggestion was pulled into [floor, ceil]. */
  clamped: boolean;
  /** Human-readable rationale for the approval screen (no PII, no money leak). */
  reason: string;
};

/** Occupancy pressure: high occupancy pushes rate up, low pulls it down. */
function occupancyFactor(occupancyBps: number): number {
  const occ = Math.max(0, Math.min(10_000, occupancyBps)) / 10_000;
  if (occ >= 0.9) return 1.25;
  if (occ >= 0.75) return 1.15;
  if (occ >= 0.5) return 1.0;
  if (occ >= 0.3) return 0.92;
  return 0.85;
}

/** Lead-time: last-minute firms up; far-out gets a small nudge down. */
function leadFactor(leadTimeDays: number): number {
  const lead = Math.max(0, leadTimeDays);
  if (lead <= 2) return 1.08;
  if (lead <= 7) return 1.03;
  if (lead >= 45) return 0.97;
  return 1.0;
}

/**
 * Clamp a paise value into [floor, ceil]. Exported so the approval path
 * (`approveRate`) and tests share the exact same bounds logic.
 */
export function clampToGuardrail(
  valuePaise: number,
  floorPaise?: number | null,
  ceilPaise?: number | null,
): number {
  let v = valuePaise;
  if (floorPaise != null) v = Math.max(v, floorPaise);
  if (ceilPaise != null) v = Math.min(v, ceilPaise);
  return v;
}

/**
 * Whether a rate is inside the category guardrail. `approveRate` uses this to
 * reject an out-of-band human-entered rate with `RATE_OUT_OF_BOUNDS` rather than
 * silently publishing it (FR-3).
 */
export function withinGuardrail(
  valuePaise: number,
  floorPaise?: number | null,
  ceilPaise?: number | null,
): boolean {
  if (floorPaise != null && valuePaise < floorPaise) return false;
  if (ceilPaise != null && valuePaise > ceilPaise) return false;
  return true;
}

/**
 * Compute a clamped, flagged rate suggestion from grounded inputs. Deterministic
 * — the multipliers come from real occupancy/lead/season inputs, never a model.
 */
export function suggestRate(input: SuggestRateInput): SuggestedRate {
  const occ = occupancyFactor(input.occupancyBps);
  const lead = leadFactor(input.leadTimeDays);
  const season = input.isPeakSeason ? 1.1 : 1.0;

  // Round half-up to the paisa at the line level (data-model.md money rules).
  const raw = new Decimal(input.basePaise)
    .times(occ)
    .times(lead)
    .times(season)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();

  const suggestedPaise = clampToGuardrail(raw, input.floorPaise, input.ceilPaise);
  const clamped = suggestedPaise !== raw;
  const occPct = Math.round((Math.max(0, Math.min(10_000, input.occupancyBps)) / 100));
  const reason =
    `occ ${occPct}% (x${occ}), lead ${Math.max(0, input.leadTimeDays)}d (x${lead})` +
    `${input.isPeakSeason ? ", peak (x1.1)" : ""}${clamped ? " — clamped to guardrail" : ""}`;

  return { suggestedPaise, clamped, reason };
}
