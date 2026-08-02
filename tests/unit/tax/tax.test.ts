/**
 * Shared tax lib — unit (19 T-4, FR-4, AC-3). Mirrors 06's GST rounding exactly:
 * CGST/SGST split half-up INDEPENDENTLY; IGST only for a genuine inter-state
 * supply (POS never takes it); round-off to the rupee.
 */
import { describe, expect, it } from "vitest";
import { computeLineTax, splitPosGst, placeOfSupply, placeOfSupplyForPos, roundOffToRupee, roundPaiseHalfUp } from "@/lib/tax";

describe("computeLineTax (AC-3)", () => {
  it("intra-state (place == property) → CGST+SGST, IGST 0", () => {
    // ₹300 @ 5% → ₹15 tax → 7.5 each → 750 paise CGST + 750 SGST.
    expect(computeLineTax(30_000, 500, "Karnataka", "Karnataka")).toEqual({ cgstPaise: 750, sgstPaise: 750, igstPaise: 0 });
  });

  it("halves are rounded HALF-UP independently (sum may exceed a single rounding)", () => {
    // total = 1 paisa; half = 0.5 → rounds to 1 each → sum 2. This is correct.
    expect(computeLineTax(100, 100, "Karnataka", "Karnataka")).toEqual({ cgstPaise: 1, sgstPaise: 1, igstPaise: 0 });
  });

  it("genuine inter-state supply → IGST (the branch POS never takes)", () => {
    expect(computeLineTax(100_000, 1800, "Karnataka", "Maharashtra")).toEqual({ cgstPaise: 0, sgstPaise: 0, igstPaise: 18_000 });
  });
});

describe("place of supply", () => {
  it("on-premise (POS/FOOD) pins to the property's state regardless of bill-to", () => {
    expect(placeOfSupply("POS", "Karnataka", "Maharashtra")).toBe("Karnataka");
    expect(placeOfSupply("FOOD", "Karnataka", "Maharashtra")).toBe("Karnataka");
    expect(placeOfSupplyForPos("Karnataka")).toBe("Karnataka");
  });

  it("a non-on-premise supply follows bill-to (or property when unknown)", () => {
    expect(placeOfSupply("GOODS", "Karnataka", "Maharashtra")).toBe("Maharashtra");
    expect(placeOfSupply("GOODS", "Karnataka", null)).toBe("Karnataka");
  });

  it("roundPaiseHalfUp rounds a plain number half-up", () => {
    expect(roundPaiseHalfUp(15.5)).toBe(16);
    expect(roundPaiseHalfUp(15.4)).toBe(15);
  });

  it("splitPosGst is ALWAYS CGST+SGST (igst 0), never inter-state", () => {
    const gst = splitPosGst(30_000, 500, "Karnataka");
    expect(gst.igstPaise).toBe(0);
    expect(gst.cgstPaise).toBe(750);
    expect(gst.sgstPaise).toBe(750);
  });
});

describe("roundOffToRupee", () => {
  it("rounds a grand total half-up to the nearest rupee, returning the signed delta", () => {
    expect(roundOffToRupee(31_500)).toEqual({ roundOffPaise: 0, totalPaise: 31_500 });
    expect(roundOffToRupee(26_250)).toEqual({ roundOffPaise: 50, totalPaise: 26_300 }); // 262.50 → 263
    expect(roundOffToRupee(31_547)).toEqual({ roundOffPaise: -47, totalPaise: 31_500 }); // 315.47 → 315
  });
});
