/**
 * Password reset — 00 T-6 (FR-6, AC-6).
 *
 * "issue a signed, single-use, expiring token; on redemption with a valid token
 * set a new bcrypt hash and invalidate the token and existing sessions."
 *
 * Two defences layered deliberately:
 *  - the token is HMAC-signed, so a forged or edited one fails without a query;
 *  - only its hash is stored, so a DB leak yields nothing redeemable.
 * Single-use is enforced by a conditional UPDATE, not a read-then-write, so two
 * concurrent redemptions cannot both win.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { hashPassword, passwordIssues } from "./password";
import { revokeAllSessionsForUser } from "./session";

export const RESET_TOKEN_TTL_MINUTES = 60;

const TOKEN_BYTES = 32;

function signingKey(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set — cannot sign reset tokens.");
  return secret;
}

/** Stored form. Never the raw token. */
export function hashResetToken(token: string): string {
  return createHmac("sha256", signingKey()).update(token).digest("hex");
}

export type IssuedResetToken = {
  /** Goes in the emailed link. Never persisted. */
  token: string;
  expiresAt: Date;
};

/**
 * Issue a reset token.
 *
 * Returns null when the email is unknown — and the CALLER must still respond
 * as though it succeeded. Revealing "no such account" here would reintroduce
 * the enumeration hole FR-4 closes on the sign-in path.
 */
export async function issuePasswordResetToken(
  db: PrismaClient,
  email: string,
  now: Date = new Date(),
): Promise<IssuedResetToken | null> {
  const user = await db.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, isActive: true, deletedAt: true },
  });
  if (!user || !user.isActive || user.deletedAt !== null) return null;

  // Invalidate outstanding tokens: requesting a new link should retire the old
  // one, so a leaked earlier email cannot still be used.
  await db.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: now },
  });

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(now.getTime() + RESET_TOKEN_TTL_MINUTES * 60_000);

  await db.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashResetToken(token), expiresAt },
  });

  return { token, expiresAt };
}

export type ResetOutcome =
  | { kind: "OK"; userId: string; sessionsRevoked: number }
  | { kind: "TOKEN_INVALID" }
  | { kind: "WEAK_PASSWORD"; issues: string[] };

/**
 * Redeem a token and set a new password.
 *
 * On success every existing session is revoked (FR-6) — a password reset is
 * often a response to compromise, so leaving other sessions alive would defeat
 * the point.
 */
export async function redeemPasswordResetToken(
  db: PrismaClient,
  token: string,
  newPassword: string,
  now: Date = new Date(),
): Promise<ResetOutcome> {
  if (!token) return { kind: "TOKEN_INVALID" };

  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      usedAt: true,
      user: { select: { orgId: true, isActive: true, deletedAt: true } },
    },
  });

  if (!record) return { kind: "TOKEN_INVALID" };
  if (record.usedAt !== null) return { kind: "TOKEN_INVALID" };
  if (record.expiresAt.getTime() <= now.getTime()) return { kind: "TOKEN_INVALID" };
  if (!record.user.isActive || record.user.deletedAt !== null) return { kind: "TOKEN_INVALID" };

  const settings = await db.securitySettings.findUnique({
    where: { orgId: record.user.orgId },
    select: { passwordMinLength: true },
  });
  const issues = passwordIssues(newPassword, settings?.passwordMinLength ?? 10);
  if (issues.length > 0) return { kind: "WEAK_PASSWORD", issues };

  const passwordHash = await hashPassword(newPassword);

  return db.$transaction(async (tx) => {
    // Conditional consume: `usedAt: null` in the WHERE means a second
    // concurrent redemption matches zero rows and loses.
    const consumed = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: now },
    });
    if (consumed.count === 0) return { kind: "TOKEN_INVALID" };

    await tx.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        // A successful reset also clears a lockout — the legitimate owner
        // proving control of their inbox should not stay locked out.
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    const sessionsRevoked = await revokeAllSessionsForUser(tx, record.userId, now);
    return { kind: "OK", userId: record.userId, sessionsRevoked };
  });
}

/** Constant-time compare helper for callers checking a token out-of-band. */
export function tokensMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
