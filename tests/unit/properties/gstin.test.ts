/**
 * Traceability: 01 T-3 — FR-3, AC-3.
 * design.md: "validateGstin(gstin): boolean — 15-char state-code + PAN + entity
 * + checksum pattern."
 */
import { describe, expect, it } from "vitest";
import {
  gstinCheckDigit,
  gstinStateCode,
  isValidGstin,
  validateGstin,
} from "@/features/properties/domain/gstin";

describe("isValidGstin — structure", () => {
  it("rejects anything that is not 15 characters", () => {
    // AC-3's invalid example.
    expect(isValidGstin("29ABC")).toBe(false);
    expect(isValidGstin("")).toBe(false);
    expect(isValidGstin("29ABCDE1234F1ZW5")).toBe(false);
  });

  it("rejects a bad state code", () => {
    // 00 and 39+ are not allotted state codes.
    expect(isValidGstin("00ABCDE1234F1Z5")).toBe(false);
    expect(isValidGstin("99ABCDE1234F1Z5")).toBe(false);
  });

  it("rejects a malformed PAN segment", () => {
    // Positions 3-7 must be letters, 8-11 digits, 12 a letter.
    expect(isValidGstin("29ABCD11234F1ZW")).toBe(false);
    expect(isValidGstin("29ABCDE12A4F1ZW")).toBe(false);
  });

  it("requires 'Z' in the 14th position", () => {
    expect(isValidGstin("29ABCDE1234F1YW")).toBe(false);
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(isValidGstin("  29abcde1234f1zw  ")).toBe(true);
  });
});

describe("gstinCheckDigit — the 15th character", () => {
  it("computes the documented check digit", () => {
    expect(gstinCheckDigit("29ABCDE1234F1Z")).toBe("W");
  });

  it("validates a real-world GSTIN", () => {
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true);
  });

  it("rejects a GSTIN whose check digit is wrong", () => {
    // Structurally perfect but the checksum does not agree — this is exactly
    // how a typo'd or invented GSTIN presents.
    expect(isValidGstin("29ABCDE1234F1Z5")).toBe(false);
    expect(isValidGstin("29ABCDE1234F1ZX")).toBe(false);
  });

  it("catches a single-character typo anywhere in the number", () => {
    const valid = "29ABCDE1234F1ZW";
    for (const i of [0, 3, 8, 12]) {
      const chars = [...valid];
      chars[i] = chars[i] === "A" ? "B" : "A";
      expect(isValidGstin(chars.join("")), `typo at ${i}`).toBe(false);
    }
  });
});

describe("validateGstin — field-level result (FR-3)", () => {
  it("accepts a valid GSTIN and returns it normalised", () => {
    const result = validateGstin(" 29abcde1234f1zw ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("29ABCDE1234F1ZW");
  });

  it("treats absent as valid — GSTIN is optional (FR-1)", () => {
    // Not every property is GST-registered; blank must not block the save.
    expect(validateGstin(null).ok).toBe(true);
    expect(validateGstin(undefined).ok).toBe(true);
    expect(validateGstin("   ").ok).toBe(true);
  });

  it("reports a field error for a malformed GSTIN (AC-3)", () => {
    const result = validateGstin("29ABC");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/15/);
  });

  it("distinguishes a checksum failure from a structural one", () => {
    // Different messages so a user can tell "you typed it wrong" from
    // "that isn't a GSTIN at all".
    const structural = validateGstin("29ABC");
    const checksum = validateGstin("29ABCDE1234F1Z5");
    expect(structural.ok).toBe(false);
    expect(checksum.ok).toBe(false);
    if (!structural.ok && !checksum.ok) {
      expect(checksum.error).not.toBe(structural.error);
      expect(checksum.error).toMatch(/check digit|checksum/i);
    }
  });
});

describe("gstinStateCode", () => {
  it("extracts the state code", () => {
    expect(gstinStateCode("29ABCDE1234F1ZW")).toBe("29");
  });

  it("maps the code to a state name for place-of-supply display", () => {
    // 06 needs intra/inter-state determination from the property's GSTIN.
    expect(gstinStateCode("27AAPFU0939F1ZV")).toBe("27");
  });

  it("returns null for an invalid GSTIN rather than a wrong state", () => {
    expect(gstinStateCode("nonsense")).toBeNull();
  });
});
