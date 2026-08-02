/**
 * 18 T-7 — dynamic-rate SUGGESTION math (FR-7, AC-8). PURE and deterministic.
 *
 * An occupancy / season / lead-time model that produces a suggested nightly rate
 * from the category base rate, clamped to the category's [floor, ceil]. This is
 * a SUGGESTION only — 18 never writes `DynamicRate`; 24 persists the suggestion
 * and drives human/threshold approval before any rate publishes.
 *
 * Grounding: the multipliers are computed from real occupancy/lead-time inputs,
 * not invented by a model.
 */

export type RateSuggestion = {
  date: string; // YYYY-MM-DD (property-local)
  suggestedPaise: number;
  /** Human-readable rationale for the 24 approval screen — no PII, no money leak. */
  reason: string;
};

export type SuggestInput = {
  date: string;
  baseRatePaise: number;
  floorPaise: number | null;
  ceilPaise: number | null;
  /** 0..1 occupancy for the date's stay window. */
  occupancy: number;
  /** Days between "now" and the stay date. */
  leadDays: number;
  /** True for a seasonal peak (config-driven upstream). */
  isPeakSeason: boolean;
};

/** Occupancy pressure: high occupancy pushes rate up, low pulls it down. */
function occupancyMultiplier(occupancy: number): number {
  if (occupancy >= 0.9) return 1.25;
  if (occupancy >= 0.75) return 1.15;
  if (occupancy >= 0.5) return 1.0;
  if (occupancy >= 0.3) return 0.92;
  return 0.85;
}

/** Lead-time: last-minute (<3d) with demand firms up; far-out gets a small nudge down. */
function leadMultiplier(leadDays: number): number {
  if (leadDays <= 2) return 1.08;
  if (leadDays <= 7) return 1.03;
  if (leadDays >= 45) return 0.97;
  return 1.0;
}

function clamp(value: number, floor: number | null, ceil: number | null): number {
  let v = value;
  if (floor != null) v = Math.max(v, floor);
  if (ceil != null) v = Math.min(v, ceil);
  return v;
}

/** Compute one date's rate suggestion from grounded inputs. */
export function suggestRateForDate(input: SuggestInput): RateSuggestion {
  const occ = occupancyMultiplier(input.occupancy);
  const lead = leadMultiplier(input.leadDays);
  const season = input.isPeakSeason ? 1.1 : 1.0;
  const raw = Math.round(input.baseRatePaise * occ * lead * season);
  const suggestedPaise = clamp(raw, input.floorPaise, input.ceilPaise);
  const reason = `occupancy ${(input.occupancy * 100).toFixed(0)}% (x${occ}), lead ${input.leadDays}d (x${lead})${input.isPeakSeason ? ", peak season (x1.1)" : ""}`;
  return { date: input.date, suggestedPaise, reason };
}
