/**
 * One-time passcode domain for the guest phone login/signup path (Phase 2).
 *
 * Pure & deterministic (clock injected) so it unit-tests without a DB. Only
 * sha256(code) is ever persisted; codes are short-lived, single-use and
 * attempt-capped. Deliberately NOT bcrypt: a 6-digit code has only 10^6 space,
 * but that space is protected by expiry + a hard attempt cap, not by a slow KDF
 * — hashing merely keeps a DB dump from revealing live codes.
 */
import { createHash, randomInt } from "node:crypto";

export const OTP_CODE_LENGTH = 6;
export const OTP_TTL_MINUTES = 10;
/** Wrong guesses allowed before the code is dead (defends the 10^6 space). */
export const OTP_MAX_ATTEMPTS = 5;
/** A new code can't be requested for the same phone within this window. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

const CODE_PATTERN = /^\d{6}$/;

/** CSPRNG 6-digit code, zero-padded. `randomInt` is uniform (no modulo bias). */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(OTP_CODE_LENGTH, "0");
}

export function hashOtpCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function isWellFormedOtpCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

export function otpExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + OTP_TTL_MINUTES * 60_000);
}

/** True once the cooldown has elapsed since the last issued code (or if none). */
export function canResendOtp(lastIssuedAt: Date | null, now: Date): boolean {
  if (!lastIssuedAt) return true;
  return now.getTime() - lastIssuedAt.getTime() >= OTP_RESEND_COOLDOWN_SECONDS * 1000;
}

export type OtpRecord = {
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
};

export type OtpCheck =
  | { ok: true }
  | { ok: false; reason: "expired" | "consumed" | "too_many_attempts" | "mismatch" };

/**
 * Verify a presented code against a stored OTP. Pure — the caller persists the
 * incremented attempt count / consumption. Order matters: exhausted/expired/
 * consumed are checked before the compare so a dead code never leaks a "closer"
 * signal, and the mismatch branch is what the caller counts against the cap.
 */
export function checkOtp(otp: OtpRecord, presentedCode: string, now: Date): OtpCheck {
  if (otp.consumedAt !== null) return { ok: false, reason: "consumed" };
  if (otp.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (otp.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: "too_many_attempts" };
  if (hashOtpCode(presentedCode) !== otp.codeHash) return { ok: false, reason: "mismatch" };
  return { ok: true };
}
