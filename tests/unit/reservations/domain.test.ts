/**
 * 03 domain unit tests — T-5..T-10. Pure, deterministic, no I/O.
 * Traceability: FR-2/5/6/11/17/19, AC-2/4/8/18/25.
 */
import { describe, expect, it } from "vitest";
import { nights } from "@/features/reservations/domain/nights";
import { priceReservation } from "@/features/reservations/domain/pricing";
import { canTransition } from "@/features/reservations/domain/transitions";
import { overlaps } from "@/features/reservations/domain/overlaps";
import { validateOccupancy } from "@/features/reservations/domain/occupancy";
import { checkRateFloor } from "@/features/reservations/domain/rate-floor";

/** A `@db.Date`-style value: UTC midnight of a calendar day. */
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("nights (T-5, FR-5/AC-2)", () => {
  it("counts calendar nights: 12–15 Jul = 3", () => {
    expect(nights(d("2026-07-12"), d("2026-07-15"), "Asia/Kolkata")).toBe(3);
  });

  it("is 1 for a same-day (day-use) stay", () => {
    expect(nights(d("2026-07-12"), d("2026-07-12"), "Asia/Kolkata")).toBe(1);
  });

  it("never returns 0 or negative for an inverted range (validation catches that upstream)", () => {
    expect(nights(d("2026-07-15"), d("2026-07-12"), "Asia/Kolkata")).toBe(1);
  });

  it("is DST-immune — a 30-night span across a northern DST change is still 30", () => {
    // US DST begins 2026-03-08; a naive ms/86400000 would miscount by an hour.
    expect(nights(d("2026-03-01"), d("2026-03-31"), "America/New_York")).toBe(30);
  });

  it("resolves an instant to the property-local day", () => {
    // 18:00 UTC on the 14th is 23:30 IST on the 14th → still the 14th locally.
    const lateUtc = new Date("2026-07-14T18:00:00.000Z");
    expect(nights(d("2026-07-12"), lateUtc, "Asia/Kolkata")).toBe(2);
  });
});

describe("priceReservation (T-6, FR-6/AC-2)", () => {
  it("computes the AC-2 bill exactly: ₹13,410 total, ₹8,410 balance", () => {
    const bill = priceReservation({
      ratePaise: 400_000,
      nights: 3,
      discountPaise: 50_000,
      extraBedPaise: 80_000,
      taxPaise: 111_000,
      advancePaise: 500_000,
    });
    expect(bill.totalPaise).toBe(1_341_000); // ₹13,410
    expect(bill.balancePaise).toBe(841_000); // ₹8,410
    expect(bill.breakdown.roomPaise).toBe(1_200_000);
  });

  it("defaults optional components to zero", () => {
    const bill = priceReservation({ ratePaise: 400_000, nights: 2 });
    expect(bill.totalPaise).toBe(800_000);
    expect(bill.balancePaise).toBe(800_000);
  });

  it("can produce a negative balance when advance exceeds total (overpayment)", () => {
    const bill = priceReservation({ ratePaise: 100_000, nights: 1, advancePaise: 150_000 });
    expect(bill.balancePaise).toBe(-50_000);
  });
});

describe("canTransition (T-7, FR-11/AC-18)", () => {
  it("allows the drawn edges", () => {
    expect(canTransition("ENQUIRY", "CONFIRMED")).toBe(true);
    expect(canTransition("ENQUIRY", "CANCELLED")).toBe(true);
    expect(canTransition("CONFIRMED", "IN_HOUSE")).toBe(true);
    expect(canTransition("CONFIRMED", "CANCELLED")).toBe(true);
    expect(canTransition("CONFIRMED", "NO_SHOW")).toBe(true);
    expect(canTransition("IN_HOUSE", "CHECKED_OUT")).toBe(true);
  });

  it("rejects check-in from a cancelled booking (AC-18)", () => {
    expect(canTransition("CANCELLED", "IN_HOUSE")).toBe(false);
  });

  it("rejects skip-ahead and reversal edges", () => {
    expect(canTransition("ENQUIRY", "IN_HOUSE")).toBe(false);
    expect(canTransition("CONFIRMED", "CHECKED_OUT")).toBe(false);
    expect(canTransition("CHECKED_OUT", "IN_HOUSE")).toBe(false);
    expect(canTransition("IN_HOUSE", "CONFIRMED")).toBe(false);
  });

  it("rejects self-loops (a room move is a different action)", () => {
    expect(canTransition("IN_HOUSE", "IN_HOUSE")).toBe(false);
  });
});

describe("overlaps (T-8, FR-2/AC-8)", () => {
  it("overlapping ranges collide", () => {
    expect(overlaps(d("2026-07-12"), d("2026-07-15"), d("2026-07-14"), d("2026-07-16"))).toBe(true);
  });

  it("adjacent ranges do NOT collide — checkout day is bookable (AC-8)", () => {
    expect(overlaps(d("2026-07-12"), d("2026-07-15"), d("2026-07-15"), d("2026-07-17"))).toBe(false);
  });

  it("fully-before and fully-after ranges don't collide", () => {
    expect(overlaps(d("2026-07-10"), d("2026-07-12"), d("2026-07-15"), d("2026-07-17"))).toBe(false);
  });

  it("a contained range collides", () => {
    expect(overlaps(d("2026-07-12"), d("2026-07-20"), d("2026-07-14"), d("2026-07-16"))).toBe(true);
  });
});

const DLX = { maxAdults: 2, maxChildren: 1 };

describe("validateOccupancy (T-9, FR-17/AC-4)", () => {
  it("accepts within category limits", () => {
    expect(validateOccupancy(DLX, 2, 1, false).ok).toBe(true);
  });

  it("rejects 3 adults into Deluxe without an extra bed (AC-4)", () => {
    const r = validateOccupancy(DLX, 3, 0, false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("OCCUPANCY_EXCEEDED");
  });

  it("accepts 3 adults with an extra-bed override (AC-4)", () => {
    expect(validateOccupancy(DLX, 3, 0, true).ok).toBe(true);
  });

  it("still rejects wildly over capacity even with an extra bed", () => {
    expect(validateOccupancy(DLX, 6, 0, true).ok).toBe(false);
  });
});

describe("checkRateFloor (T-10, FR-19/AC-25)", () => {
  const cat = { floorPaise: 300_000 };
  const opts = (perm: boolean) => ({ discountThresholdPaise: 100_000, hasDiscountPermission: perm });

  it("accepts a normal rate/discount with no override needed", () => {
    const r = checkRateFloor(cat, 400_000, 50_000, opts(false));
    expect(r).toEqual({ ok: true, override: false });
  });

  it("rejects a ₹3,000 discount above threshold without folio:discount (AC-25)", () => {
    const r = checkRateFloor(cat, 400_000, 300_000, opts(false));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("RATE_BELOW_FLOOR");
  });

  it("accepts the over-threshold discount WITH permission, flagged as an override (AC-25)", () => {
    const r = checkRateFloor(cat, 400_000, 300_000, opts(true));
    expect(r).toEqual({ ok: true, override: true });
  });

  it("treats a rate below the category floor the same way", () => {
    expect(checkRateFloor(cat, 250_000, 0, opts(false)).ok).toBe(false);
    expect(checkRateFloor(cat, 250_000, 0, opts(true))).toEqual({ ok: true, override: true });
  });

  it("skips the floor check when the category has no floor", () => {
    expect(checkRateFloor({ floorPaise: null }, 1, 0, opts(false))).toEqual({ ok: true, override: false });
  });
});
