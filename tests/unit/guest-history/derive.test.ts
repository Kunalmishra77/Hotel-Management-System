/**
 * 05 guest-history domain — T-3/T-4 (FR-1/6, AC-1/2/12). Pure derivation tests.
 */
import { describe, expect, it } from "vitest";
import { deriveStats, preferredCategory, preferredRate } from "@/features/guest-history/domain/derive";

const stay = (o: Partial<Parameters<typeof deriveStats>[0][number]>) => ({
  status: "CHECKED_OUT", nights: 2, ratePaise: 400_000, checkOutAt: new Date("2026-07-15"),
  checkInDate: new Date("2026-07-13"), categoryId: "cat_deluxe", ...o,
});

describe("deriveStats (AC-1/2/12)", () => {
  it("derives 3 stays / 8 nights, revenue from billing, preferred Deluxe (AC-1)", () => {
    const reservations = [
      stay({ nights: 3, checkOutAt: new Date("2026-05-04") }),
      stay({ nights: 3, checkOutAt: new Date("2026-06-04") }),
      stay({ nights: 2, checkOutAt: new Date("2026-07-15") }),
    ];
    const s = deriveStats(reservations, { revenuePaise: 4_200_000, outstandingPaise: 0 });
    expect(s.visits).toBe(3);
    expect(s.totalRoomNights).toBe(8);
    expect(s.totalRevenuePaise).toBe(4_200_000);
    expect(s.outstandingPaise).toBe(0);
    expect(s.preferredCategoryId).toBe("cat_deluxe");
    expect(s.lastStayAt).toEqual(new Date("2026-07-15"));
  });

  it("is all-zero for a guest with no stays (AC-2)", () => {
    const s = deriveStats([], { revenuePaise: 0, outstandingPaise: 0 });
    expect(s).toMatchObject({ visits: 0, totalRoomNights: 0, totalRevenuePaise: 0, preferredCategoryId: null, lastStayAt: null });
  });

  it("never counts cancelled / no-show reservations (AC-12)", () => {
    const reservations = [
      stay({ status: "CANCELLED", nights: 5 }),
      stay({ status: "NO_SHOW", nights: 5 }),
    ];
    const s = deriveStats(reservations, { revenuePaise: 0, outstandingPaise: 0 });
    expect(s.visits).toBe(0);
    expect(s.totalRoomNights).toBe(0);
  });

  it("counts an in-house stay as a visit", () => {
    const s = deriveStats([stay({ status: "IN_HOUSE", checkOutAt: null })], { revenuePaise: 0, outstandingPaise: 0 });
    expect(s.visits).toBe(1);
  });
});

describe("preferred category / rate (mode)", () => {
  it("picks the most frequent category and rate", () => {
    const rs = [
      stay({ categoryId: "deluxe", ratePaise: 400_000 }),
      stay({ categoryId: "deluxe", ratePaise: 400_000 }),
      stay({ categoryId: "suite", ratePaise: 700_000 }),
    ];
    expect(preferredCategory(rs)).toBe("deluxe");
    expect(preferredRate(rs)).toBe(400_000);
  });

  it("returns null when there are no real stays", () => {
    expect(preferredCategory([stay({ status: "CANCELLED" })])).toBeNull();
    expect(preferredRate([])).toBeNull();
  });
});
