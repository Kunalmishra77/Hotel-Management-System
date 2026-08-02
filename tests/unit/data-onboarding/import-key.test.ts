/** 26 T-6 — importKeyFor natural idempotency key (FR-6, AC-11). */
import { describe, expect, it } from "vitest";
import { importKeyFor } from "@/features/data-onboarding/domain/import-key";
import type { NormalizedRow } from "@/features/data-onboarding/domain/validate";

function n(over: Partial<NormalizedRow>): NormalizedRow {
  return {
    fullName: null, mobile: null, email: null, gstNumber: null, city: null, state: null,
    companyName: null, aadhaarMasked: null, checkInDate: null, checkOutDate: null, source: null,
    categoryName: null, roomNo: null, externalRef: null, amountPaise: null, adults: null, children: null,
    ...over,
  };
}

describe("importKeyFor", () => {
  it("GUESTS/BALANCES key on normalised mobile (same across re-imports)", () => {
    expect(importKeyFor("GUESTS", n({ mobile: "9800000101" }))).toBe("GUESTS:9800000101");
    expect(importKeyFor("BALANCES", n({ mobile: "9800000101" }))).toBe("BALANCES:9800000101");
  });

  it("RESERVATIONS prefers the external ref, else mobile+dates", () => {
    expect(importKeyFor("RESERVATIONS", n({ externalRef: "LEGACY-1", mobile: "9800000101" }))).toBe("RESERVATIONS:ref:LEGACY-1");
    const key = importKeyFor("RESERVATIONS", n({
      mobile: "9800000101",
      checkInDate: new Date("2024-11-01"),
      checkOutDate: new Date("2024-11-03"),
    }));
    expect(key).toBe("RESERVATIONS:9800000101:2024-11-01:2024-11-03");
  });

  it("returns null when the identifying field is absent", () => {
    expect(importKeyFor("GUESTS", n({}))).toBeNull();
    expect(importKeyFor("RESERVATIONS", n({ mobile: "9800000101" }))).toBeNull();
  });
});
