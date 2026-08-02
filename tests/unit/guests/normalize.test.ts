/**
 * Traceability: 04 T-4 — FR-5/FR-6/FR-10.
 *
 * Normalisation is what makes dedupe and search work: "+91 98765 43210",
 * "098765 43210" and "9876543210" are one person, and if they normalise
 * differently the duplicate check silently misses them.
 */
import { describe, expect, it } from "vitest";
import {
  isValidIndianMobile,
  normalizeEmail,
  normalizeGstin,
  normalizePhone,
} from "@/features/guests/domain/normalize";

describe("normalizePhone — Indian mobile numbers (FR-5/FR-6)", () => {
  it("reduces every common written form to the same 10 digits", () => {
    // These are all the same guest; dedupe depends on that being true.
    for (const written of [
      "9876543210",
      "98765 43210",
      "98765-43210",
      "+91 9876543210",
      "+919876543210",
      "0091 9876543210",
      "09876543210",
      "91-98765-43210",
      "  9876543210  ",
      "(98765) 43210",
    ]) {
      expect(normalizePhone(written), written).toBe("9876543210");
    }
  });

  it("keeps a genuinely different number different", () => {
    expect(normalizePhone("9876543210")).not.toBe(normalizePhone("9876543211"));
  });

  it("returns null for input that is not a usable number", () => {
    for (const bad of ["", "   ", "abc", "12345", "+44 20 7946 0958"]) {
      expect(normalizePhone(bad), bad).toBeNull();
    }
  });

  it("cannot distinguish a trunk-prefixed landline from a mobile — documented limit", () => {
    // "080 40001000" is a Bangalore landline, but stripping the trunk 0 leaves
    // "8040001000": ten digits starting 8, which is a structurally valid
    // mobile. Telling them apart needs a numbering-plan database we do not
    // have, so this normalises rather than rejecting.
    //
    // The consequence is bounded and acceptable: a landline entered in the
    // mobile field is stored and hashed as-is. It never merges two guests,
    // because the token still differs from any real mobile — it only means
    // 12-communications may fail to reach that number, which it reports.
    expect(normalizePhone("080 40001000")).toBe("8040001000");
  });

  it("still rejects a landline whose digits cannot be a mobile", () => {
    // 011 (Delhi) + 8 digits → "1123456789", starts with 1, correctly refused.
    expect(normalizePhone("011 23456789")).toBeNull();
  });
});

describe("isValidIndianMobile (FR-6)", () => {
  it("accepts a 10-digit number starting 6-9", () => {
    for (const ok of ["9876543210", "8123456789", "7000000000", "6000000000"]) {
      expect(isValidIndianMobile(ok), ok).toBe(true);
    }
  });

  it("rejects numbers starting 0-5 — not allotted to mobiles", () => {
    for (const bad of ["5876543210", "1234567890", "0987654321"]) {
      expect(isValidIndianMobile(bad), bad).toBe(false);
    }
  });

  it("rejects the wrong length", () => {
    expect(isValidIndianMobile("987654321")).toBe(false);
    expect(isValidIndianMobile("98765432101")).toBe(false);
  });
});

describe("normalizeEmail (FR-5/FR-10)", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Ravi.Kumar@Example.COM ")).toBe("ravi.kumar@example.com");
  });

  it("treats case-different addresses as the same guest", () => {
    expect(normalizeEmail("RAVI@example.com")).toBe(normalizeEmail("ravi@example.com"));
  });

  it("does NOT strip gmail dots or +tags", () => {
    // Tempting, but wrong: only some providers treat those as equivalent, and
    // silently merging two real addresses is worse than a missed duplicate.
    expect(normalizeEmail("ravi.kumar@gmail.com")).toBe("ravi.kumar@gmail.com");
    expect(normalizeEmail("ravi+hotel@gmail.com")).toBe("ravi+hotel@gmail.com");
  });

  it("returns null for absent or malformed input", () => {
    for (const bad of ["", "   ", "not-an-email", "@example.com", "ravi@"]) {
      expect(normalizeEmail(bad), bad).toBeNull();
    }
  });
});

describe("normalizeGstin (FR-10 search)", () => {
  it("uppercases and strips spaces", () => {
    expect(normalizeGstin(" 29abcde1234f1zw ")).toBe("29ABCDE1234F1ZW");
  });

  it("returns null when absent", () => {
    expect(normalizeGstin("")).toBeNull();
    expect(normalizeGstin(null)).toBeNull();
  });
});
