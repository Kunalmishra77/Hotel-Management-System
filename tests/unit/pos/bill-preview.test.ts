/**
 * billPreview — unit (19 T-4, FR-3/4, AC-2/3). Uses the shared lib/tax split;
 * F&B is on-premise so igst is ALWAYS 0; discount is pre-tax and apportioned.
 */
import { describe, expect, it } from "vitest";
import { billPreview } from "@/features/pos/domain/bill-preview";

const KA = "Karnataka";

describe("billPreview (AC-2/3)", () => {
  it("₹300 @ 5% → CGST 2.5% + SGST 2.5%, igst 0, total ₹315", () => {
    const bill = billPreview(
      [{ quantity: 2, unitPaise: 12_000, gstBps: 500 }, { quantity: 1, unitPaise: 6_000, gstBps: 500 }],
      0,
      KA,
    );
    expect(bill.subtotalPaise).toBe(30_000);
    expect(bill.cgstPaise).toBe(750);
    expect(bill.sgstPaise).toBe(750);
    expect(bill.igstPaise).toBe(0);
    expect(bill.roundOffPaise).toBe(0);
    expect(bill.totalPaise).toBe(31_500);
  });

  it("a pre-tax discount reduces the taxable value before GST", () => {
    const bill = billPreview([{ quantity: 1, unitPaise: 30_000, gstBps: 500 }], 5_000, KA);
    // net taxable 25,000 @ 5% → 1,250 → 625 each; grand 26,250 → round to ₹263.
    expect(bill.discountPaise).toBe(5_000);
    expect(bill.cgstPaise).toBe(625);
    expect(bill.sgstPaise).toBe(625);
    expect(bill.roundOffPaise).toBe(50);
    expect(bill.totalPaise).toBe(26_300);
  });

  it("computes GST per rate-group for a mixed-rate order", () => {
    const bill = billPreview(
      [{ quantity: 1, unitPaise: 10_000, gstBps: 500 }, { quantity: 1, unitPaise: 10_000, gstBps: 1200 }],
      0,
      KA,
    );
    // 500bps: 10,000 → 250+250; 1200bps: 10,000 → 600+600.
    expect(bill.cgstPaise).toBe(850);
    expect(bill.sgstPaise).toBe(850);
    expect(bill.igstPaise).toBe(0);
  });

  it("igst is 0 for POS even with a large order", () => {
    const bill = billPreview([{ quantity: 100, unitPaise: 50_000, gstBps: 500 }], 0, KA);
    expect(bill.igstPaise).toBe(0);
  });
});
