/**
 * TOTP enrolment + the second-factor challenge — 00 T-4 (FR-3/FR-5, AC-2/3/5).
 *
 * Sign-in with 2FA is two steps. Step one (credentials) does NOT create a
 * session; it issues a short-lived, single-purpose *challenge* that proves the
 * password was already accepted. Step two exchanges that challenge plus a TOTP
 * (or backup) code for a real session.
 *
 * The challenge is stored as a `PasswordResetToken`-style hash? No — it is
 * signed and stateless (HMAC over userId+expiry), so a half-finished sign-in
 * leaves no row to clean up and cannot be replayed after expiry.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { decryptString, encryptString } from "../crypto/encryption";
import {
  buildOtpAuthUrl,
  consumeBackupCode,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  verifyTotp,
} from "./totp";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * How long the user has to enter their code after the password step.
 * Long enough to open an authenticator app, short enough that a stolen
 * challenge is near-useless.
 */
export const TOTP_CHALLENGE_TTL_MS = 5 * 60_000;

function challengeKey(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set — cannot sign the 2FA challenge.");
  return secret;
}

/** `<userId>.<expiresAtMs>.<hmac>` — stateless and tamper-evident. */
export function issueTotpChallenge(userId: string, now: Date = new Date()): string {
  const expiresAt = now.getTime() + TOTP_CHALLENGE_TTL_MS;
  const body = `${userId}.${expiresAt}`;
  const mac = createHmac("sha256", challengeKey()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/** Returns the userId the challenge attests to, or null if invalid/expired. */
export function verifyTotpChallenge(challenge: string, now: Date = new Date()): string | null {
  const parts = challenge.split(".");
  if (parts.length !== 3) return null;

  const [userId, expiresRaw, mac] = parts as [string, string, string];
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return null;

  const expected = createHmac("sha256", challengeKey())
    .update(`${userId}.${expiresRaw}`)
    .digest("base64url");

  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return userId;
}

// ---------------------------------------------------------------------------
// Enrolment (FR-5 / AC-5)
// ---------------------------------------------------------------------------

export type EnrolmentOffer = {
  /** Plaintext, shown once as a QR + manual key. Never persisted in the clear. */
  secret: string;
  otpAuthUrl: string;
};

/**
 * Begin enrolment: generate a secret and stage it encrypted, but leave
 * `totpEnabled` false. AC-5 requires a confirming code before 2FA activates —
 * otherwise a mis-scanned QR would lock the user out of their own account.
 */
export async function beginTotpEnrolment(db: Db, userId: string): Promise<EnrolmentOffer | null> {
  const user = await db.user.findFirst({
    where: { id: userId, isActive: true, deletedAt: null },
    select: { email: true },
  });
  if (!user) return null;

  const secret = generateTotpSecret();
  await db.user.update({
    where: { id: userId },
    data: { totpSecret: encryptString(secret), totpEnabled: false },
  });

  return { secret, otpAuthUrl: buildOtpAuthUrl({ secret, accountName: user.email }) };
}

export type ConfirmEnrolmentResult =
  | { ok: true; backupCodes: string[] }
  | { ok: false; reason: "NO_PENDING_SECRET" | "INVALID_CODE" };

/**
 * Activate 2FA once the user proves they can generate a code, and hand back the
 * backup codes — shown once, stored hashed (AC-5).
 */
export async function confirmTotpEnrolment(
  db: Db,
  userId: string,
  code: string,
  now: Date = new Date(),
): Promise<ConfirmEnrolmentResult> {
  const user = await db.user.findFirst({
    where: { id: userId, isActive: true, deletedAt: null },
    select: { totpSecret: true },
  });
  if (!user?.totpSecret) return { ok: false, reason: "NO_PENDING_SECRET" };

  const secret = decryptString(user.totpSecret);
  if (!verifyTotp(secret, code, now)) return { ok: false, reason: "INVALID_CODE" };

  const backupCodes = generateBackupCodes(10);
  await db.user.update({
    where: { id: userId },
    data: { totpEnabled: true, backupCodes: backupCodes.map(hashBackupCode) },
  });

  return { ok: true, backupCodes };
}

/** Turn 2FA off and discard the secret + codes (admin/user action, audited by the caller). */
export async function disableTotp(db: Db, userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { totpEnabled: false, totpSecret: null, backupCodes: [] },
  });
}

// ---------------------------------------------------------------------------
// Second-factor verification (AC-2 / AC-3)
// ---------------------------------------------------------------------------

export type SecondFactorResult =
  | { kind: "OK"; usedBackupCode: boolean }
  | { kind: "INVALID" }
  | { kind: "NOT_ENROLLED" };

/**
 * Verify a TOTP code, falling back to a backup code.
 *
 * The backup-code branch consumes atomically under a row lock: design.md flags
 * "Race on backup-code reuse → consume atomically". Two concurrent sign-ins
 * presenting the same code must not both succeed, so the winner is decided by
 * an UPDATE whose WHERE still contains the code — if it matched zero rows,
 * someone else consumed it first.
 */
export async function verifySecondFactor(
  db: PrismaClient,
  userId: string,
  code: string,
  now: Date = new Date(),
): Promise<SecondFactorResult> {
  const user = await db.user.findFirst({
    where: { id: userId, isActive: true, deletedAt: null },
    select: { totpSecret: true, totpEnabled: true, backupCodes: true },
  });
  if (!user?.totpEnabled || !user.totpSecret) return { kind: "NOT_ENROLLED" };

  if (verifyTotp(decryptString(user.totpSecret), code, now)) {
    return { kind: "OK", usedBackupCode: false };
  }

  const attempt = consumeBackupCode(code, user.backupCodes);
  if (!attempt.consumed) return { kind: "INVALID" };

  // Conditional write: only succeeds while the code is still present.
  const { count } = await db.user.updateMany({
    where: { id: userId, backupCodes: { has: hashBackupCode(code) } },
    data: { backupCodes: attempt.remainingHashes },
  });
  if (count === 0) return { kind: "INVALID" }; // lost the race — already used

  return { kind: "OK", usedBackupCode: true };
}
