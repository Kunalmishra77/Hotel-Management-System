/**
 * Traceability: 01 T-4 — FR-6, AC-6/AC-7.
 *
 * reporting.md is explicit that TWO occupancy figures exist and must not be
 * conflated. This module owns (b), the live point-in-time status rollup:
 *   OCCUPIED ÷ (active rooms − UNDER_MAINTENANCE)
 * RESERVED is sold in (a) room-night occupancy, but is NOT occupied here.
 */
import { describe, expect, it } from "vitest";
import {
  formatOccupancyPercent,
  occupancyRollup,
  type RoomStatusInput,
} from "@/features/properties/domain/occupancy";

/** ROOMS-A from the fixture table: 6 VACANT, 3 OCCUPIED, 1 UNDER_MAINTENANCE. */
const ROOMS_A: RoomStatusInput[] = [
  ...Array.from({ length: 6 }, () => ({ status: "VACANT" as const, isActive: true })),
  ...Array.from({ length: 3 }, () => ({ status: "OCCUPIED" as const, isActive: true })),
  { status: "UNDER_MAINTENANCE" as const, isActive: true },
];

describe("occupancyRollup — counts (AC-6)", () => {
  it("counts ROOMS-A exactly as the fixture describes", () => {
    const r = occupancyRollup(ROOMS_A);
    expect(r.total).toBe(10);
    expect(r.vacant).toBe(6);
    expect(r.occupied).toBe(3);
    expect(r.maintenance).toBe(1);
    expect(r.reserved).toBe(0);
    expect(r.housekeeping).toBe(0);
  });

  it("counts every status the schema defines", () => {
    const r = occupancyRollup([
      { status: "VACANT", isActive: true },
      { status: "OCCUPIED", isActive: true },
      { status: "RESERVED", isActive: true },
      { status: "UNDER_MAINTENANCE", isActive: true },
      { status: "HOUSEKEEPING", isActive: true },
    ]);
    expect(r).toMatchObject({
      total: 5,
      vacant: 1,
      occupied: 1,
      reserved: 1,
      maintenance: 1,
      housekeeping: 1,
    });
  });

  it("excludes inactive rooms from the total", () => {
    // A decommissioned room is not part of the property's sellable stock.
    const r = occupancyRollup([...ROOMS_A, { status: "VACANT", isActive: false }]);
    expect(r.total).toBe(10);
  });
});

describe("occupancyRollup — live current-status occupancy (AC-6/AC-7)", () => {
  it("is 33% for ROOMS-A: 3 occupied ÷ (10 − 1 maintenance)", () => {
    // AC-6 states this number explicitly.
    const r = occupancyRollup(ROOMS_A);
    expect(r.availableForOccupancy).toBe(9);
    expect(r.occupancyBps).toBe(3333); // 3/9 = 33.33%
    expect(formatOccupancyPercent(r.occupancyBps)).toBe("33%");
  });

  it("becomes 44% when one vacant room is checked in (AC-7)", () => {
    const afterCheckIn: RoomStatusInput[] = [
      ...Array.from({ length: 5 }, () => ({ status: "VACANT" as const, isActive: true })),
      ...Array.from({ length: 4 }, () => ({ status: "OCCUPIED" as const, isActive: true })),
      { status: "UNDER_MAINTENANCE" as const, isActive: true },
    ];
    const r = occupancyRollup(afterCheckIn);
    expect(r.occupied).toBe(4);
    expect(r.occupancyBps).toBe(4444); // 4/9 = 44.44%
    expect(formatOccupancyPercent(r.occupancyBps)).toBe("44%");
  });

  it("does NOT count RESERVED as occupied (reporting.md)", () => {
    // This is the whole point of the (a)/(b) distinction. A reserved room is
    // sold for a future night; nobody is in it right now.
    const r = occupancyRollup([
      { status: "OCCUPIED", isActive: true },
      { status: "RESERVED", isActive: true },
      { status: "VACANT", isActive: true },
    ]);
    expect(r.occupied).toBe(1);
    expect(r.occupancyBps).toBe(3333); // 1/3, not 2/3
  });

  it("excludes UNDER_MAINTENANCE from the denominator, not just the numerator", () => {
    // 1 occupied of 2 sellable = 50%, NOT 1/3 = 33%.
    const r = occupancyRollup([
      { status: "OCCUPIED", isActive: true },
      { status: "VACANT", isActive: true },
      { status: "UNDER_MAINTENANCE", isActive: true },
    ]);
    expect(r.availableForOccupancy).toBe(2);
    expect(r.occupancyBps).toBe(5000);
  });

  it("counts HOUSEKEEPING rooms as available but not occupied", () => {
    // A room being cleaned is between guests — sellable today.
    const r = occupancyRollup([
      { status: "OCCUPIED", isActive: true },
      { status: "HOUSEKEEPING", isActive: true },
    ]);
    expect(r.availableForOccupancy).toBe(2);
    expect(r.occupancyBps).toBe(5000);
  });
});

describe("occupancyRollup — edge cases", () => {
  it("is 0%, not NaN, for a property with no rooms", () => {
    const r = occupancyRollup([]);
    expect(r.total).toBe(0);
    expect(r.availableForOccupancy).toBe(0);
    expect(r.occupancyBps).toBe(0);
    expect(formatOccupancyPercent(r.occupancyBps)).toBe("0%");
  });

  it("is 0%, not a divide-by-zero, when every room is under maintenance", () => {
    const r = occupancyRollup([
      { status: "UNDER_MAINTENANCE", isActive: true },
      { status: "UNDER_MAINTENANCE", isActive: true },
    ]);
    expect(r.availableForOccupancy).toBe(0);
    expect(r.occupancyBps).toBe(0);
  });

  it("is exactly 100% when every sellable room is occupied", () => {
    const r = occupancyRollup([
      { status: "OCCUPIED", isActive: true },
      { status: "OCCUPIED", isActive: true },
      { status: "UNDER_MAINTENANCE", isActive: true },
    ]);
    expect(r.occupancyBps).toBe(10000);
    expect(formatOccupancyPercent(r.occupancyBps)).toBe("100%");
  });

  it("never exceeds 100%", () => {
    const r = occupancyRollup(
      Array.from({ length: 50 }, () => ({ status: "OCCUPIED" as const, isActive: true })),
    );
    expect(r.occupancyBps).toBeLessThanOrEqual(10000);
  });

  it("stays in basis points — an integer, never a float (data-model.md)", () => {
    // 1/3 must not become 0.3333333333333333 anywhere near a stored value.
    const r = occupancyRollup([
      { status: "OCCUPIED", isActive: true },
      { status: "VACANT", isActive: true },
      { status: "VACANT", isActive: true },
    ]);
    expect(Number.isInteger(r.occupancyBps)).toBe(true);
  });
});

describe("formatOccupancyPercent", () => {
  it("rounds to a whole percent for the tile", () => {
    expect(formatOccupancyPercent(3333)).toBe("33%");
    expect(formatOccupancyPercent(6667)).toBe("67%");
    expect(formatOccupancyPercent(0)).toBe("0%");
    expect(formatOccupancyPercent(10000)).toBe("100%");
  });
});
