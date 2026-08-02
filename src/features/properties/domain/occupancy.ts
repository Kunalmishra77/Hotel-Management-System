/**
 * Live property occupancy rollup — 01 T-4 (FR-6, AC-6/AC-7). Pure domain.
 *
 * ⚠️ THIS IS NOT THE ADR/RevPAR OCCUPANCY.
 *
 * `reporting.md` defines two distinct figures and forbids conflating them:
 *   (a) **room-night occupancy** over a date range — owned by 14, the metric
 *       authority; RESERVED rooms count as sold for their booked nights.
 *   (b) **live point-in-time status rollup** — this module:
 *          OCCUPIED ÷ (active rooms − UNDER_MAINTENANCE)
 *       RESERVED is NOT occupied here: the room is sold for a future night, but
 *       nobody is standing in it.
 *
 * The overview tile must be labelled "current-status occupancy" so nobody reads
 * it as the RevPAR denominator.
 *
 * Expressed in basis points (integer, 0–10000) rather than a float, per
 * `data-model.md` — the same discipline as money. A percentage that has been
 * through floating point is a percentage that can be 33.33333333333333.
 */
import type { RoomStatus } from "@prisma/client";

export type RoomStatusInput = {
  status: RoomStatus;
  isActive: boolean;
};

export type OccupancyRollup = {
  /** Active rooms only — a decommissioned room is not sellable stock. */
  total: number;
  vacant: number;
  occupied: number;
  reserved: number;
  maintenance: number;
  housekeeping: number;
  /** The denominator: active rooms minus those under maintenance. */
  availableForOccupancy: number;
  /** Basis points, 0–10000. 3333 = 33.33%. */
  occupancyBps: number;
};

export function occupancyRollup(rooms: readonly RoomStatusInput[]): OccupancyRollup {
  let total = 0;
  let vacant = 0;
  let occupied = 0;
  let reserved = 0;
  let maintenance = 0;
  let housekeeping = 0;

  for (const room of rooms) {
    if (!room.isActive) continue;
    total += 1;

    switch (room.status) {
      case "VACANT":
        vacant += 1;
        break;
      case "OCCUPIED":
        occupied += 1;
        break;
      case "RESERVED":
        reserved += 1;
        break;
      case "UNDER_MAINTENANCE":
        maintenance += 1;
        break;
      case "HOUSEKEEPING":
        housekeeping += 1;
        break;
    }
  }

  // Maintenance rooms leave the denominator entirely — they cannot be sold, so
  // counting them would understate how full the property actually is.
  const availableForOccupancy = total - maintenance;

  const occupancyBps =
    availableForOccupancy === 0
      ? 0 // no sellable rooms ⇒ 0%, never a divide-by-zero NaN
      : Math.min(10_000, Math.round((occupied * 10_000) / availableForOccupancy));

  return {
    total,
    vacant,
    occupied,
    reserved,
    maintenance,
    housekeeping,
    availableForOccupancy,
    occupancyBps,
  };
}

/** Whole-percent display for the overview tile. */
export function formatOccupancyPercent(occupancyBps: number): string {
  return `${Math.round(occupancyBps / 100)}%`;
}

/**
 * Aggregate straight from grouped counts, so the overview never fetches
 * per-room rows (design.md § Edge cases: "Very large property (1000 rooms) →
 * overview count query stays indexed; no per-room fetch").
 */
export function occupancyRollupFromCounts(
  counts: Partial<Record<RoomStatus, number>>,
): OccupancyRollup {
  const vacant = counts.VACANT ?? 0;
  const occupied = counts.OCCUPIED ?? 0;
  const reserved = counts.RESERVED ?? 0;
  const maintenance = counts.UNDER_MAINTENANCE ?? 0;
  const housekeeping = counts.HOUSEKEEPING ?? 0;
  const total = vacant + occupied + reserved + maintenance + housekeeping;
  const availableForOccupancy = total - maintenance;

  return {
    total,
    vacant,
    occupied,
    reserved,
    maintenance,
    housekeeping,
    availableForOccupancy,
    occupancyBps:
      availableForOccupancy === 0
        ? 0
        : Math.min(10_000, Math.round((occupied * 10_000) / availableForOccupancy)),
  };
}
