/** A GST-inclusive rate bills EXACTLY that amount (client, 17 Nov 2026: ₹2,400 incl. billed ₹2,399.99). */
import { describe, expect, it } from "vitest";
import { preTaxRatePaise } from "@/features/reservations/domain/pricing";
import { preTaxRoomPaise, computeGst } from "@/features/billing/domain/gst";

const gross = (pre: number) => { const g = computeGst(pre, 500, "DL", "DL"); return pre + g.cgstPaise + g.sgstPaise; };

describe("GST-inclusive room rate → exact total", () => {
  it.each([240_000, 255_200, 252_000, 199_900, 350_000, 100_000])("₹%d paise incl.", (incl) => {
    expect(gross(preTaxRoomPaise(incl, "inclusive"))).toBe(incl);
    expect(gross(preTaxRatePaise(incl, "inclusive"))).toBe(incl);
  });
  it("exclusive is unchanged", () => {
    expect(preTaxRoomPaise(240_000, "exclusive")).toBe(240_000);
  });
});
