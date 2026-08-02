/**
 * 06 billing domain unit tests — T-4..T-7, T-C2. The money core: exhaustive,
 * every path CONFIRMED. Traceability: FR-4/6/8/10/12/16/19/27, AC-2..11/13/16/27.
 */
import { describe, expect, it } from "vitest";
import { computeGst, placeOfSupply, roundPaiseHalfUp } from "@/features/billing/domain/gst";
import { folioBalance, netPaid, refundWithinNetPaid } from "@/features/billing/domain/balance";
import { discountLine, financialYearOf, splitSumsTo } from "@/features/billing/domain/money";
import { amountInWords } from "@/features/billing/domain/words";
import { formatInvoiceNumber } from "@/features/billing/domain/invoice-number";
import { computeCouponDiscount } from "@/features/billing/domain/coupon-discount";

const KA = "Karnataka";
const MH = "Maharashtra";

describe("placeOfSupply (T-4, FR-4, AC-4/4b)", () => {
  it("on-premise supplies are always the property's state, regardless of bill-to (AC-4)", () => {
    expect(placeOfSupply("ROOM", KA, MH)).toBe(KA);
    expect(placeOfSupply("LAUNDRY", KA, MH)).toBe(KA);
    expect(placeOfSupply("FOOD", KA, MH)).toBe(KA);
  });
  it("a genuine off-premise supply follows the bill-to state (AC-4b)", () => {
    expect(placeOfSupply("MISC", KA, MH)).toBe(MH);
  });
  it("falls back to the property state when there is no bill-to", () => {
    expect(placeOfSupply("MISC", KA, null)).toBe(KA);
  });
});

describe("computeGst (T-4, FR-4/19, AC-3/4/4b/5)", () => {
  it("intra-state splits into equal CGST + SGST (AC-3: ₹1,000 @ 18%)", () => {
    expect(computeGst(100_000, 1800, KA, KA)).toEqual({ cgstPaise: 9000, sgstPaise: 9000, igstPaise: 0 });
  });
  it("inter-state is IGST only (AC-4b)", () => {
    expect(computeGst(100_000, 1800, KA, MH)).toEqual({ cgstPaise: 0, sgstPaise: 0, igstPaise: 18000 });
  });
  it("rounds each half independently, half-up (AC-5)", () => {
    // 15 paise @ ... contrived: amount 1 paise @ 1500 bps → total 0.15 → each half 0.075 → 0.
    // Use a case where the halves round up: total 15 → half 7.5 → 8 + 8 = 16 (sum may exceed by 1).
    const g = computeGst(100, 3000, KA, KA); // 100 * 0.30 = 30 → half 15 → 15 + 15 = 30
    expect(g.cgstPaise + g.sgstPaise).toBe(30);
    const odd = computeGst(50, 3000, KA, KA); // 50*0.30 = 15 → half 7.5 → 8 each → 16
    expect(odd.cgstPaise).toBe(8);
    expect(odd.sgstPaise).toBe(8);
  });
  it("roundPaiseHalfUp rounds .5 up", () => {
    expect(roundPaiseHalfUp(7.5)).toBe(8);
    expect(roundPaiseHalfUp(7.49)).toBe(7);
  });
});

describe("folioBalance + refunds (T-5, FR-3/10, AC-2/11)", () => {
  const lines = [
    { amountPaise: 1_200_000n, cgstPaise: 72_000, sgstPaise: 72_000, igstPaise: 0 }, // room 12,000 + 1,440
    { amountPaise: 100_000n, cgstPaise: 9000, sgstPaise: 9000, igstPaise: 0 }, // laundry 1,000 + 180
  ];
  it("balance = charges+tax − payments (no stored column) (AC-2)", () => {
    const bal = folioBalance(lines, [{ amountPaise: 500_000n, isRefund: false }]);
    // (1,200,000+144,000) + (100,000+18,000) − 500,000 = 962,000
    expect(bal).toBe(962_000n);
  });
  it("a refund is ADDED BACK to the balance (AC-11)", () => {
    const payments = [
      { amountPaise: 1_462_000n, isRefund: false }, // paid in full
      { amountPaise: 200_000n, isRefund: true }, // ₹2,000 refunded
    ];
    const bal = folioBalance(lines, payments);
    // charges 1,462,000 − (1,462,000 − 200,000) = 200,000 owed again
    expect(bal).toBe(200_000n);
  });
  it("netPaid = Σ non-refund − Σ refund; refund guard respects it (AC-11)", () => {
    const payments = [
      { amountPaise: 1_341_000n, isRefund: false },
      { amountPaise: 200_000n, isRefund: true },
    ];
    expect(netPaid(payments)).toBe(1_141_000n);
    expect(refundWithinNetPaid(1_141_000n, payments)).toBe(true);
    expect(refundWithinNetPaid(1_141_001n, payments)).toBe(false);
  });
  it("a ₹15,000 refund on ₹13,410 paid is rejected (AC-11)", () => {
    expect(refundWithinNetPaid(1_500_000, [{ amountPaise: 1_341_000n, isRefund: false }])).toBe(false);
  });
});

describe("splitSumsTo (T-6, FR-23, AC-8/9)", () => {
  it("accepts parts that sum to the total (AC-8)", () => {
    expect(splitSumsTo([500_000, 841_000], 1_341_000)).toBe(true);
  });
  it("rejects a mismatched split (AC-9)", () => {
    expect(splitSumsTo([500_000, 800_000], 1_341_000)).toBe(false);
  });
});

describe("financialYearOf (T-6, FR-12, AC-13)", () => {
  it("July 2026 → 2026-27", () => {
    expect(financialYearOf(new Date("2026-07-12T00:00:00Z"), "Asia/Kolkata")).toBe("2026-27");
  });
  it("March 2027 still → 2026-27 (before the 1 Apr boundary)", () => {
    expect(financialYearOf(new Date("2027-03-31T00:00:00Z"), "Asia/Kolkata")).toBe("2026-27");
  });
  it("April 2027 → 2027-28 (on/after the boundary)", () => {
    expect(financialYearOf(new Date("2027-04-01T00:00:00Z"), "Asia/Kolkata")).toBe("2027-28");
  });
});

describe("discountLine (T-6, FR-6, AC-6)", () => {
  it("PRE_TAX carries negated proportional CGST/SGST", () => {
    const l = discountLine(50_000, 1200, KA, KA, "PRE_TAX"); // ₹500 @ 12%
    expect(l.amountPaise).toBe(-50_000);
    expect(l.cgstPaise).toBe(-3000);
    expect(l.sgstPaise).toBe(-3000);
  });
  it("FINANCIAL carries zero tax", () => {
    const l = discountLine(50_000, 1200, KA, KA, "FINANCIAL");
    expect(l.amountPaise).toBe(-50_000);
    expect(l).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 0, taxRateBps: 0 });
  });
});

describe("amountInWords (T-7, FR-16, AC-16)", () => {
  it("₹13,410 in Indian numbering", () => {
    expect(amountInWords(1_341_000)).toBe("Rupees Thirteen Thousand Four Hundred Ten Only");
  });
  it("includes paise when present", () => {
    expect(amountInWords(150_050)).toBe("Rupees One Thousand Five Hundred and Fifty Paise Only");
  });
  it("handles lakh/crore grouping", () => {
    expect(amountInWords(1_23_45_678_00)).toContain("Crore");
  });
});

describe("formatInvoiceNumber", () => {
  it("zero-pads the sequence within a prefixed FY series", () => {
    expect(formatInvoiceNumber({ prefix: "WMG", financialYear: "2026-27", nextNumber: 42 })).toBe("WMG/2026-27/00042");
  });
});

describe("computeCouponDiscount (T-C2, FR-27, AC-27)", () => {
  const SAVE10 = { discountType: "PERCENT" as const, discountBps: 1000, discountPaise: null, maxDiscountPaise: 50_000, minBookingPaise: 200_000 };
  it("10% of ₹4,000 = ₹400, under the ₹500 cap (AC-27)", () => {
    expect(computeCouponDiscount(SAVE10, 400_000)).toBe(40_000);
  });
  it("caps a large percent at maxDiscountPaise", () => {
    expect(computeCouponDiscount(SAVE10, 1_000_000)).toBe(50_000); // 10% = 1,000 → capped 500
  });
  it("is zero below the minimum booking (gate)", () => {
    expect(computeCouponDiscount(SAVE10, 100_000)).toBe(0);
  });
  it("FIXED never exceeds the booking value", () => {
    const fixed = { discountType: "FIXED" as const, discountBps: null, discountPaise: 100_000, maxDiscountPaise: null, minBookingPaise: 0 };
    expect(computeCouponDiscount(fixed, 50_000)).toBe(50_000);
    expect(computeCouponDiscount(fixed, 500_000)).toBe(100_000);
  });
});
