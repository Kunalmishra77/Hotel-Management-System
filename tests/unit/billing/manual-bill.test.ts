import { describe, it, expect } from "vitest";
import { manualLine, manualBillTotal, manualRoundOff } from "@/features/billing/domain/manual-bill";

describe("FR-MB-1 â€” manual bill lines", () => {
  it("exclusive: GST adds on top, split CGST/SGST", () => {
    const l = manualLine({ description: "Room", quantity: 2, ratePaise: 200_000, gstBps: 500, inclusive: false }, "Delhi");
    expect(l.amountPaise).toBe(400_000);
    expect(l.cgstPaise).toBe(10_000);
    expect(l.sgstPaise).toBe(10_000);
    expect(l.igstPaise).toBe(0);
    expect(manualBillTotal([l])).toBe(420_000);
  });
  it("inclusive: bills exactly the typed total", () => {
    const l = manualLine({ description: "Room", quantity: 1, ratePaise: 240_000, gstBps: 500, inclusive: true }, "Delhi");
    expect(manualBillTotal([l])).toBe(240_000);
    const inp = { description: "Dinner", quantity: 3, ratePaise: 99_900, gstBps: 1800, inclusive: true };
    const m = manualLine(inp, "Delhi");
    // No exact pre-tax value exists at 18% here — the round-off line closes the gap.
    expect(manualBillTotal([m]) + manualRoundOff([inp], [m])).toBe(299_700);
    expect(Math.abs(manualRoundOff([inp], [m]))).toBeLessThanOrEqual(2);
  });
  it("0% GST has no tax", () => {
    const l = manualLine({ description: "Deposit", quantity: 1, ratePaise: 50_000, gstBps: 0, inclusive: true }, "Delhi");
    expect(l.amountPaise).toBe(50_000);
    expect(l.cgstPaise + l.sgstPaise).toBe(0);
  });
});
