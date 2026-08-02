/**
 * Traceability: 04 T-5 — FR-4/FR-8, AC-5/AC-7.
 */
import { describe, expect, it } from "vitest";
import { aadhaarMasked, maskContact, maskIdValue } from "@/features/guests/domain/masking";

describe("maskContact (FR-8 / AC-7)", () => {
  it("masks a mobile to the last 4 digits", () => {
    expect(maskContact("9800000001", "mobile")).toBe("XXXXXX0001");
    expect(maskContact("9800000001", "whatsapp")).toBe("XXXXXX0001");
  });

  it("masks an email local part but keeps the domain", () => {
    expect(maskContact("ravi@ex.com", "email")).toBe("r•••@ex.com");
  });

  it("returns null for an absent value, never the string 'null'", () => {
    expect(maskContact(null, "mobile")).toBeNull();
    expect(maskContact(undefined, "email")).toBeNull();
    expect(maskContact("", "mobile")).toBeNull();
  });

  it("never echoes the full contact value", () => {
    expect(maskContact("9800000001", "mobile")).not.toContain("980000");
  });
});

describe("maskIdValue (FR-4 / AC-5)", () => {
  it("masks Aadhaar to the UIDAI last-4 form", () => {
    expect(maskIdValue("AADHAAR", "123456789012")).toBe("XXXX XXXX 9012");
    // Spaced input is tolerated (AC-5 shows the value with spaces).
    expect(maskIdValue("AADHAAR", "1234 5678 9012")).toBe("XXXX XXXX 9012");
  });

  it("shows the last 4 characters for a passport or other ID", () => {
    expect(maskIdValue("PASSPORT", "M1234567")).toBe("XXXX4567");
    expect(maskIdValue("PAN", "ABCDE1234F")).toBe("XXXXXX234F");
  });

  it("never echoes the full number", () => {
    expect(maskIdValue("AADHAAR", "123456789012")).not.toContain("12345678");
    expect(maskIdValue("PASSPORT", "M1234567")).not.toContain("M123");
  });

  it("returns null for absent values", () => {
    expect(maskIdValue("AADHAAR", null)).toBeNull();
  });
});

describe("aadhaarMasked (FR-4)", () => {
  it("is the value actually stored while full storage is off", () => {
    expect(aadhaarMasked("123456789012")).toBe("XXXX XXXX 9012");
  });

  it("degrades safely on a too-short value rather than throwing", () => {
    expect(aadhaarMasked("12")).toBe("XXXX XXXX XXXX");
  });
});
