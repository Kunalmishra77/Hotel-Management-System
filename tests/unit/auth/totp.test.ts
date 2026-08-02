/**
 * Traceability: 00 FR-3/FR-5, AC-2 (valid current TOTP issues the session),
 * AC-3 (backup code is single-use), AC-5 (enrolment confirmed by a TOTP).
 * design.md § Edge cases: clock skew ⇒ allow a ±1 step window.
 */
import { describe, expect, it } from "vitest";
import { authenticator } from "otplib";
import {
  TOTP_STEP_SECONDS,
  buildOtpAuthUrl,
  consumeBackupCode,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  verifyTotp,
} from "@/lib/auth/totp";

const AT = new Date("2026-07-21T10:00:00.000Z");

function codeAt(secret: string, at: Date): string {
  authenticator.options = { epoch: at.getTime(), step: TOTP_STEP_SECONDS };
  const token = authenticator.generate(secret);
  authenticator.resetOptions();
  return token;
}

describe("generateTotpSecret", () => {
  it("returns a base32 secret usable by an authenticator app", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+=*$/);
    expect(secret.length).toBeGreaterThanOrEqual(16);
  });

  it("is different every time", () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });
});

describe("verifyTotp — injected clock (design.md: testable, no real time)", () => {
  const secret = generateTotpSecret();

  it("accepts the current code", () => {
    expect(verifyTotp(secret, codeAt(secret, AT), AT)).toBe(true);
  });

  it("accepts a code one step old (clock skew, −1 window)", () => {
    const prev = new Date(AT.getTime() - TOTP_STEP_SECONDS * 1000);
    expect(verifyTotp(secret, codeAt(secret, prev), AT)).toBe(true);
  });

  it("accepts a code one step ahead (clock skew, +1 window)", () => {
    const next = new Date(AT.getTime() + TOTP_STEP_SECONDS * 1000);
    expect(verifyTotp(secret, codeAt(secret, next), AT)).toBe(true);
  });

  it("rejects a code two steps old — the window is ±1, not open-ended", () => {
    const old = new Date(AT.getTime() - TOTP_STEP_SECONDS * 2000);
    expect(verifyTotp(secret, codeAt(secret, old), AT)).toBe(false);
  });

  it("rejects a wrong code", () => {
    expect(verifyTotp(secret, "000000", AT)).toBe(false);
  });

  it("rejects malformed input without throwing", () => {
    for (const bad of ["", "abc", "12345", "1234567", "  "]) {
      expect(verifyTotp(secret, bad, AT)).toBe(false);
    }
  });

  it("rejects a code generated for a different secret", () => {
    const other = generateTotpSecret();
    expect(verifyTotp(secret, codeAt(other, AT), AT)).toBe(false);
  });
});

describe("backup codes (AC-3: single-use, stored hashed)", () => {
  it("generates the requested number of distinct codes", () => {
    const codes = generateBackupCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
  });

  it("hashes are not the plaintext code", () => {
    const [code] = generateBackupCodes(1);
    expect(code).toBeDefined();
    expect(hashBackupCode(code!)).not.toBe(code);
  });

  it("hashing is deterministic so a presented code can be matched", () => {
    const [code] = generateBackupCodes(1);
    expect(hashBackupCode(code!)).toBe(hashBackupCode(code!));
  });

  it("ignores formatting differences when matching", () => {
    const [code] = generateBackupCodes(1);
    expect(hashBackupCode(code!.toLowerCase())).toBe(hashBackupCode(code!.toUpperCase()));
  });

  it("consumes a valid code and removes exactly that hash", () => {
    const codes = generateBackupCodes(3);
    const stored = codes.map(hashBackupCode);
    const result = consumeBackupCode(codes[1]!, stored);

    expect(result.consumed).toBe(true);
    expect(result.remainingHashes).toHaveLength(2);
    expect(result.remainingHashes).not.toContain(hashBackupCode(codes[1]!));
    expect(result.remainingHashes).toContain(hashBackupCode(codes[0]!));
  });

  it("refuses to reuse an already-consumed code (AC-3)", () => {
    const codes = generateBackupCodes(2);
    const stored = codes.map(hashBackupCode);
    const first = consumeBackupCode(codes[0]!, stored);
    const second = consumeBackupCode(codes[0]!, first.remainingHashes);

    expect(first.consumed).toBe(true);
    expect(second.consumed).toBe(false);
    expect(second.remainingHashes).toEqual(first.remainingHashes);
  });

  it("rejects an unknown code and leaves the set untouched", () => {
    const stored = generateBackupCodes(2).map(hashBackupCode);
    const result = consumeBackupCode("NOTACODE", stored);
    expect(result.consumed).toBe(false);
    expect(result.remainingHashes).toEqual(stored);
  });
});

describe("buildOtpAuthUrl (AC-5: the QR the user scans)", () => {
  it("encodes issuer, account and secret", () => {
    const url = buildOtpAuthUrl({
      secret: "JBSWY3DPEHPK3PXP",
      accountName: "reception@woodpecker.example",
      issuer: "Woodpecker PMS",
    });
    expect(url.startsWith("otpauth://totp/")).toBe(true);
    expect(url).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(url).toContain("issuer=Woodpecker");
  });
});
