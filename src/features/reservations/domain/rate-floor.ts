/**
 * checkRateFloor() — 03 T-10 (FR-19, AC-25).
 *
 * Two guardrails on booking money:
 *  - a rate **below** the category floor (`RoomCategory.floorPaise`), and
 *  - a discount **above** the org threshold (`SecuritySettings.discountThresholdPaise`).
 *
 * Either one requires the `folio:discount` permission and produces an audited
 * override; without the permission it is rejected. Within limits, no override and
 * no special permission is needed.
 *
 * The caller writes the audit override row when `override: true` — this pure
 * function only decides *whether* the entry is allowed and whether it is an
 * override, so it stays testable without I/O.
 *
 * AC-25: a ₹3,000 discount (above Reception's ₹1,000 threshold) is rejected
 * without `folio:discount`; with it, accepted **and** flagged as an override.
 */
export type RateFloorResult =
  | { ok: true; override: boolean }
  | { ok: false; code: "RATE_BELOW_FLOOR" };

export function checkRateFloor(
  category: { floorPaise: number | null },
  ratePaise: number,
  discountPaise: number,
  opts: { discountThresholdPaise: number; hasDiscountPermission: boolean },
): RateFloorResult {
  const belowFloor = category.floorPaise != null && ratePaise < category.floorPaise;
  const overThreshold = discountPaise > opts.discountThresholdPaise;

  if (!belowFloor && !overThreshold) return { ok: true, override: false };
  if (opts.hasDiscountPermission) return { ok: true, override: true };
  return { ok: false, code: "RATE_BELOW_FLOOR" };
}
