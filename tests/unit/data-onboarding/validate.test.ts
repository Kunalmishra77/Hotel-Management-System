/** 26 T-4 — validateRow per kind: required/type/format (FR-3, AC-4). */
import { describe, expect, it } from "vitest";
import { validateRow } from "@/features/data-onboarding/domain/validate";

describe("validateRow GUESTS", () => {
  it("accepts a well-formed guest and normalises mobile/email/gstin", () => {
    const r = validateRow(
      { fullName: "  Asha   Rao ", mobile: "+91 98000 00101", email: "ASHA@Example.com", city: "Bengaluru" },
      "GUESTS",
    );
    expect(r.ok).toBe(true);
    expect(r.normalized.fullName).toBe("Asha Rao");
    expect(r.normalized.mobile).toBe("9800000101");
    expect(r.normalized.email).toBe("asha@example.com");
  });

  it("flags a missing mobile as ERROR with a reason", () => {
    const r = validateRow({ fullName: "No Mobile", email: "x@y.com" }, "GUESTS");
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/mobile/i);
  });

  it("flags an invalid mobile / email / GSTIN", () => {
    const r = validateRow({ fullName: "Bad", mobile: "12345", email: "not-an-email", gstNumber: "NOPE" }, "GUESTS");
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("masks Aadhaar to last-4 and never keeps the full value (AC-14)", () => {
    const r = validateRow({ fullName: "Asha", mobile: "9800000101", aadhaar: "1111 2222 3333" }, "GUESTS");
    expect(r.normalized.aadhaarMasked).toBe("XXXX-XXXX-3333");
  });
});

describe("validateRow RESERVATIONS", () => {
  it("requires a valid guest mobile, dates and a category/room", () => {
    const ok = validateRow(
      { mobile: "9800000101", checkInDate: "2024-11-01", checkOutDate: "2024-11-03", source: "DIRECT", categoryName: "Deluxe" },
      "RESERVATIONS",
    );
    expect(ok.ok).toBe(true);
    expect(ok.normalized.checkInDate?.toISOString().slice(0, 10)).toBe("2024-11-01");

    const bad = validateRow({ mobile: "9800000101", checkInDate: "2024-11-05", checkOutDate: "2024-11-01", categoryName: "Deluxe" }, "RESERVATIONS");
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(" ")).toMatch(/before check-in/i);
  });

  it("rejects an unknown booking source", () => {
    const r = validateRow({ mobile: "9800000101", checkInDate: "2024-11-01", checkOutDate: "2024-11-02", source: "PIGEON", categoryName: "Deluxe" }, "RESERVATIONS");
    expect(r.ok).toBe(false);
  });
});

describe("validateRow BALANCES", () => {
  it("parses ₹ rupees to positive paise", () => {
    const r = validateRow({ mobile: "9800000101", amount: "₹1,500.50" }, "BALANCES");
    expect(r.ok).toBe(true);
    expect(r.normalized.amountPaise).toBe(150_050);
  });

  it("rejects a non-positive amount", () => {
    expect(validateRow({ mobile: "9800000101", amount: "0" }, "BALANCES").ok).toBe(false);
    expect(validateRow({ mobile: "9800000101", amount: "abc" }, "BALANCES").ok).toBe(false);
  });
});
