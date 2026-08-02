/**
 * 14 metric library — T-3/T-5 (FR-1/11, AC-1/2), per reporting.md. Pure.
 * These are THE definitions 08 reuses; the numbers here are the AC-1 fixture.
 */
import { describe, expect, it } from "vitest";
import { occupancy, adr, revpar, availableRoomNights, profit, snapshotFrom } from "@/features/analytics/domain/metrics";

describe("canonical metrics (AC-1)", () => {
  // STATE-A: 10 rooms, 1 maintenance, 1 night → available 9; occupied 6; ₹24,000.
  it("occupancy 6/9 = 6667 bps", () => {
    expect(occupancy(9, 6)).toBe(6667);
  });
  it("ADR = 24,000 / 6 = ₹4,000", () => {
    expect(adr(2_400_000, 6)).toBe(400_000);
  });
  it("RevPAR = 24,000 / 9 ≈ ₹2,666.67 → 266667 paise", () => {
    expect(revpar(2_400_000, 9)).toBe(266_667);
  });
  it("availableRoomNights = sellable×nights − blocked", () => {
    expect(availableRoomNights(10, 1, 1)).toBe(9);
    expect(availableRoomNights(10, 0, 7)).toBe(70);
  });
  it("profit = revenue − expense (BigInt)", () => {
    expect(profit(68_000_000n, 36_000_000n)).toBe(32_000_000n);
  });
});

describe("zero / edge (no divide-by-zero)", () => {
  it("0 available → 0 occupancy/revpar", () => {
    expect(occupancy(0, 0)).toBe(0);
    expect(revpar(2_400_000, 0)).toBe(0);
  });
  it("0 occupied → 0 ADR", () => {
    expect(adr(0, 0)).toBe(0);
  });
});

describe("snapshotFrom (FR-6)", () => {
  it("assembles a day's stats with derived adr/revpar/occupancy", () => {
    const s = snapshotFrom({ availableRoomNights: 9, occupiedRoomNights: 6, roomRevenuePaise: 2_400_000n, totalRevenuePaise: 2_400_000n, expensePaise: 0n });
    expect(s.occupancyBps).toBe(6667);
    expect(s.adrPaise).toBe(400_000);
    expect(s.revparPaise).toBe(266_667);
  });
});
