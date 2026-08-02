/**
 * 23 T-3 — depositAmount (FR-5, AC-5). Full / percent / fixed, clamped to
 * [1, total], half-up rounding on the percent path.
 */
import { describe, expect, it } from "vitest";
import { depositAmount } from "@/features/booking-engine/domain/deposit";

describe("depositAmount", () => {
  it("FULL charges the whole total", () => {
    expect(depositAmount(1_344_000, { depositPolicy: "FULL", depositValue: 0 })).toBe(1_344_000);
  });

  it("PCT charges basis-points of the total (2000 bps = 20%)", () => {
    // ₹13,440 incl. GST → 20% = ₹2,688 = 268800 paise (AC-5).
    expect(depositAmount(1_344_000, { depositPolicy: "PCT", depositValue: 2000 })).toBe(268_800);
  });

  it("PCT rounds half-up to the paisa", () => {
    // 12345 × 10% = 1234.5 → 1235
    expect(depositAmount(12_345, { depositPolicy: "PCT", depositValue: 1000 })).toBe(1235);
  });

  it("FIXED charges exactly the configured paise", () => {
    expect(depositAmount(1_344_000, { depositPolicy: "FIXED", depositValue: 500_000 })).toBe(500_000);
  });

  it("never exceeds the total", () => {
    expect(depositAmount(1000, { depositPolicy: "FIXED", depositValue: 999_999 })).toBe(1000);
  });

  it("is never zero for a positive total", () => {
    expect(depositAmount(1000, { depositPolicy: "PCT", depositValue: 0 })).toBe(1);
  });

  it("is zero only for a zero/negative total", () => {
    expect(depositAmount(0, { depositPolicy: "FULL", depositValue: 0 })).toBe(0);
  });
});
