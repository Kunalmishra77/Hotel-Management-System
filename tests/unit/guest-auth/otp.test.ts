/**
 * Traceability: Phase 2 (customer redesign) — guest phone OTP domain.
 *
 * The OTP is the whole security of the phone login path: get expiry, single-use,
 * or the attempt cap wrong and a 6-digit code (10^6 space) becomes brute-forceable
 * or replayable. These are pure, clock-injected checks — no DB.
 */
import { describe, expect, it } from "vitest";
import {
  OTP_CODE_LENGTH,
  OTP_MAX_ATTEMPTS,
  checkOtp,
  canResendOtp,
  generateOtpCode,
  hashOtpCode,
  isWellFormedOtpCode,
  otpExpiryFrom,
  type OtpRecord,
} from "@/lib/guest-auth/otp";

const NOW = new Date("2026-08-14T10:00:00.000Z");

function otp(overrides: Partial<OtpRecord> = {}): OtpRecord {
  return {
    codeHash: hashOtpCode("123456"),
    expiresAt: new Date(NOW.getTime() + 5 * 60_000),
    consumedAt: null,
    attempts: 0,
    ...overrides,
  };
}

describe("generateOtpCode", () => {
  it("is always a zero-padded 6-digit numeric string", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateOtpCode();
      expect(code).toHaveLength(OTP_CODE_LENGTH);
      expect(isWellFormedOtpCode(code)).toBe(true);
    }
  });

  it("hashOtpCode is stable and never returns the plaintext", () => {
    expect(hashOtpCode("000000")).toBe(hashOtpCode("000000"));
    expect(hashOtpCode("000000")).not.toBe("000000");
    expect(hashOtpCode("000000")).not.toBe(hashOtpCode("000001"));
  });
});

describe("isWellFormedOtpCode", () => {
  it("rejects non-6-digit input", () => {
    for (const bad of ["", "12345", "1234567", "12a456", "abcdef", " 123456"]) {
      expect(isWellFormedOtpCode(bad)).toBe(false);
    }
  });
});

describe("checkOtp", () => {
  it("accepts the correct code before expiry", () => {
    expect(checkOtp(otp(), "123456", NOW)).toEqual({ ok: true });
  });

  it("rejects a wrong code as a mismatch (the branch that counts against the cap)", () => {
    expect(checkOtp(otp(), "999999", NOW)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects an expired code even if it matches", () => {
    const expired = otp({ expiresAt: new Date(NOW.getTime() - 1000) });
    expect(checkOtp(expired, "123456", NOW)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects an already-consumed code (no replay)", () => {
    const used = otp({ consumedAt: new Date(NOW.getTime() - 1000) });
    expect(checkOtp(used, "123456", NOW)).toEqual({ ok: false, reason: "consumed" });
  });

  it("rejects once the attempt cap is reached, before comparing", () => {
    const exhausted = otp({ attempts: OTP_MAX_ATTEMPTS });
    // Correct code still rejected — the cap is a hard wall.
    expect(checkOtp(exhausted, "123456", NOW)).toEqual({ ok: false, reason: "too_many_attempts" });
  });

  it("treats expiry as inclusive (exactly at expiresAt is expired)", () => {
    const atBoundary = otp({ expiresAt: NOW });
    expect(checkOtp(atBoundary, "123456", NOW)).toEqual({ ok: false, reason: "expired" });
  });
});

describe("canResendOtp", () => {
  it("allows the first send (no prior code)", () => {
    expect(canResendOtp(null, NOW)).toBe(true);
  });

  it("blocks a resend inside the cooldown and allows it after", () => {
    expect(canResendOtp(new Date(NOW.getTime() - 30_000), NOW)).toBe(false);
    expect(canResendOtp(new Date(NOW.getTime() - 61_000), NOW)).toBe(true);
  });
});

describe("otpExpiryFrom", () => {
  it("is in the future", () => {
    expect(otpExpiryFrom(NOW).getTime()).toBeGreaterThan(NOW.getTime());
  });
});
