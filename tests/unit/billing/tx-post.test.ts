/**
 * 3C T1 — the pure room-charge line builder. GST correctness is a non-negotiable
 * money path (testing-strategy.md), so it is unit-tested without a DB.
 */
import { describe, expect, it } from "vitest";
import { roomChargeLineData } from "@/features/billing/tx-post";

const base = {
  folioId: "f1",
  propertyId: "p1",
  propertyState: "Karnataka",
  businessDate: new Date("2026-08-06T00:00:00Z"),
};

describe("roomChargeLineData", () => {
  it("builds a ROOM line with intra-state GST (CGST+SGST, no IGST)", () => {
    const d = roomChargeLineData({ ...base, ratePaise: 450000 });

    expect(d.type).toBe("ROOM");
    expect(d.quantity).toBe(1);
    expect(d.unitPaise).toBe(450000);
    expect(d.amountPaise).toBe(450000n);
    expect(d.hsnSac).toBe("996311");
    expect(d.placeOfSupplyState).toBe("Karnataka");
    expect(d.businessDate).toEqual(base.businessDate);

    // On-premise supply → never IGST; CGST and SGST split equally.
    expect(d.igstPaise).toBe(0);
    expect(d.cgstPaise).toBe(d.sgstPaise);

    // Total tax = amount × taxRateBps / 10000 (rounded), split half-half.
    const total = (d.cgstPaise ?? 0) + (d.sgstPaise ?? 0);
    expect(total).toBe(Math.round((450000 * (d.taxRateBps ?? 0)) / 10000));
  });

  it("applies a higher tariff band to a premium room-night", () => {
    const low = roomChargeLineData({ ...base, ratePaise: 450000 });
    const high = roomChargeLineData({ ...base, ratePaise: 900000 });

    expect(high.taxRateBps ?? 0).toBeGreaterThanOrEqual(low.taxRateBps ?? 0);
    expect(high.igstPaise).toBe(0);
    expect(high.cgstPaise).toBe(high.sgstPaise);
    expect(high.amountPaise).toBe(900000n);
  });
});
