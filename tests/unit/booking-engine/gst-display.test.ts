/**
 * 23 T-5 — gstInclusiveDisplay (FR-3/15, AC-1/18). The displayed inclusive total
 * equals net + tax and, by construction, equals what will be charged.
 */
import { describe, expect, it } from "vitest";
import { gstInclusiveDisplay } from "@/features/booking-engine/domain/gst-display";

describe("gstInclusiveDisplay", () => {
  it("computes ₹4,000/night × 3n @ 12% = ₹13,440 incl. GST (AC-1)", () => {
    const d = gstInclusiveDisplay(400_000, 3, 1200, 1);
    expect(d.netPaise).toBe(1_200_000);
    expect(d.taxPaise).toBe(144_000);
    expect(d.grossPaise).toBe(1_344_000);
  });

  it("multiplies across rooms", () => {
    const d = gstInclusiveDisplay(400_000, 3, 1200, 2);
    expect(d.grossPaise).toBe(2_688_000);
  });

  it("rounds the tax half-up to the paisa", () => {
    // net 12345 @ 12% = 1481.4 → 1481
    const d = gstInclusiveDisplay(12_345, 1, 1200, 1);
    expect(d.taxPaise).toBe(1481);
    expect(d.grossPaise).toBe(13_826);
  });

  it("gross always equals net + tax (charged == displayed)", () => {
    const d = gstInclusiveDisplay(333_333, 2, 500, 3);
    expect(d.grossPaise).toBe(d.netPaise + d.taxPaise);
  });
});
