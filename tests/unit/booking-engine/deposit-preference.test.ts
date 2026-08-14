/**
 * Traceability: Phase 2 T-5 — signed-in guest payment choice.
 *
 * The online-amount decision is a money path, so it is pure and tested exactly:
 * pay-at-hotel collects nothing, pay-now collects the whole total, partial
 * collects the configured deposit. Getting this wrong over/under-charges a guest.
 */
import { describe, expect, it } from "vitest";
import { depositForPreference } from "@/features/booking-engine/domain/deposit";

const PCT_20 = { depositPolicy: "PCT" as const, depositValue: 2000 }; // 20%
const FIXED = { depositPolicy: "FIXED" as const, depositValue: 50_000 };

describe("depositForPreference", () => {
  it("PAY_AT_HOTEL collects nothing online", () => {
    expect(depositForPreference("PAY_AT_HOTEL", 1_000_00, PCT_20)).toBe(0);
    expect(depositForPreference("PAY_AT_HOTEL", 0, FIXED)).toBe(0);
  });

  it("PAY_NOW collects the whole total", () => {
    expect(depositForPreference("PAY_NOW", 1_000_00, PCT_20)).toBe(1_000_00);
  });

  it("PARTIAL collects the configured deposit (PCT)", () => {
    // 20% of ₹1000 = ₹200 = 20000 paise.
    expect(depositForPreference("PARTIAL", 1_000_00, PCT_20)).toBe(20_000);
  });

  it("PARTIAL collects the configured deposit (FIXED), clamped to the total", () => {
    expect(depositForPreference("PARTIAL", 1_000_00, FIXED)).toBe(50_000);
    // Deposit can never exceed the total.
    expect(depositForPreference("PARTIAL", 30_000, FIXED)).toBe(30_000);
  });

  it("the online amount never exceeds the total for any preference", () => {
    for (const pref of ["PAY_AT_HOTEL", "PARTIAL", "PAY_NOW"] as const) {
      const total = 75_000;
      expect(depositForPreference(pref, total, PCT_20)).toBeLessThanOrEqual(total);
    }
  });
});
