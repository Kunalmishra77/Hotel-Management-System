import { describe, it, expect } from "vitest";
import { otaDeduction, DEFAULT_DEDUCTION } from "@/features/reports/domain/ota-deduction";

describe("OTA deduction breakdown", () => {
  it("MMT ₹2,552 incl. GST at 18% commission on the pre-GST value", () => {
    // ₹2,430.48 taxable + ₹121.52 GST (5%) = ₹2,552
    const d = otaDeduction(243_048, 12_152, { ...DEFAULT_DEDUCTION, commissionBps: 1800 });
    expect(d.commissionPaise).toBe(43_749);
    expect(d.gstOnCommissionPaise).toBe(7_875);
    expect(d.tcsPaise).toBe(1_215);
    expect(d.tdsPaise).toBe(243);
    expect(d.netPaise).toBe(255_200 - 43_749 - 7_875 - 1_215 - 243);
  });
  it("commission on the GST-inclusive amount when the OTA bills that way", () => {
    const d = otaDeduction(100_000, 5_000, { ...DEFAULT_DEDUCTION, commissionBps: 1000, commissionOnGross: true });
    expect(d.commissionPaise).toBe(10_500);
  });
  it("defaults never invent a commission — only statutory TCS/TDS", () => {
    const d = otaDeduction(100_000, 5_000, DEFAULT_DEDUCTION);
    expect(d.commissionPaise).toBe(0);
    expect(d.deductionPaise).toBe(500 + 100);
  });
  it("Expedia statement (Jarl-era screenshot): 18% + Accelerator 7%, no GST/TCS/TDS → payout ₹2,399.20", () => {
    const d = otaDeduction(299_900, 14_995, { commissionBps: 1800, commissionOnGross: false, extraFeeBps: 700, gstOnCommissionBps: 0, tcsBps: 0, tdsBps: 0 });
    expect(d.commissionPaise).toBe(53_982);
    expect(d.extraFeePaise).toBe(20_993);
    expect(d.netPaise).toBe(239_920);
  });
});
