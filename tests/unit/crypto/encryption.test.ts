/**
 * Traceability: compliance.md (PII encrypted at rest), 00 FR-5 (TOTP secret
 * encrypted at rest), data-model.md § PII.
 *
 * Written before the implementation (testing-strategy.md: test-first for
 * domain logic).
 */
import { describe, expect, it } from "vitest";
import {
  decryptString,
  encryptString,
  isEncrypted,
  keyedHash,
  maskAadhaar,
  maskEmail,
  maskMobile,
} from "@/lib/crypto/encryption";

describe("encryptString / decryptString", () => {
  it("round-trips a value", () => {
    const plain = "9876543210";
    expect(decryptString(encryptString(plain))).toBe(plain);
  });

  it("round-trips unicode and empty-ish values", () => {
    for (const v of ["नमस्ते", "a", " ", "x".repeat(5000)]) {
      expect(decryptString(encryptString(v))).toBe(v);
    }
  });

  it("produces a different ciphertext each time (random IV)", () => {
    // Deterministic ciphertext would leak equality between guests' fields.
    const a = encryptString("same-value");
    const b = encryptString("same-value");
    expect(a).not.toBe(b);
    expect(decryptString(a)).toBe(decryptString(b));
  });

  it("rejects a tampered ciphertext rather than returning garbage", () => {
    // GCM auth tag must be verified — a silently-wrong plaintext would be worse
    // than an error for an Aadhaar or a bank account.
    const enc = encryptString("sensitive");
    const parts = enc.split(".");
    const body = Buffer.from(parts[2] ?? "", "base64");
    body[0] = (body[0] ?? 0) ^ 0xff;
    parts[2] = body.toString("base64");
    expect(() => decryptString(parts.join("."))).toThrow();
  });

  it("rejects a malformed envelope", () => {
    expect(() => decryptString("not-encrypted")).toThrow();
    expect(() => decryptString("v1.only-two")).toThrow();
  });

  it("labels its output so encrypted columns are recognisable", () => {
    expect(isEncrypted(encryptString("x"))).toBe(true);
    expect(isEncrypted("plain text")).toBe(false);
  });
});

describe("keyedHash", () => {
  it("is deterministic, so exact-match search works without decrypting", () => {
    expect(keyedHash("9876543210")).toBe(keyedHash("9876543210"));
  });

  it("differs for different inputs", () => {
    expect(keyedHash("9876543210")).not.toBe(keyedHash("9876543211"));
  });

  it("normalises case and surrounding whitespace", () => {
    // Guests get typed in inconsistently; search must still match.
    expect(keyedHash(" Ravi@Example.COM ")).toBe(keyedHash("ravi@example.com"));
  });

  it("is not reversible to the input", () => {
    expect(keyedHash("9876543210")).not.toContain("9876543210");
  });
});

describe("masking (compliance.md — masked by default)", () => {
  it("masks Aadhaar to the last 4 digits", () => {
    expect(maskAadhaar("123412341234")).toBe("XXXX XXXX 1234");
  });

  it("tolerates spaced Aadhaar input", () => {
    expect(maskAadhaar("1234 1234 1234")).toBe("XXXX XXXX 1234");
  });

  it("never echoes the full Aadhaar", () => {
    expect(maskAadhaar("123412341234")).not.toContain("12341234");
  });

  it("masks a mobile to the last 4 digits", () => {
    expect(maskMobile("9876543210")).toBe("XXXXXX3210");
  });

  it("masks an email local part but keeps the domain", () => {
    expect(maskEmail("ravi.kumar@example.com")).toBe("r•••••••••@example.com");
  });

  it("returns null for absent values rather than the string 'null'", () => {
    expect(maskMobile(null)).toBeNull();
    expect(maskEmail(undefined)).toBeNull();
    expect(maskAadhaar(null)).toBeNull();
  });
});
