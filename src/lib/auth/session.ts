/**
 * DB-backed session lifecycle — 00 FR-2/FR-7/FR-27, AC-1/AC-25.
 *
 * security.md: "Sessions: DB-backed (`Session` model), short-lived + rotated…
 * Every request re-checks `Session.revokedAt` server-side, so force-logout and
 * permission changes take effect immediately."
 *
 * The cookie holds an opaque random token and nothing else. Every request
 * resolves it to a row, re-checks expiry/revocation, and rebuilds claims from
 * live data — so authority is never cached in something the client holds.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { assembleClaims, type SessionClaims } from "./claims";
import { generateSessionToken, hashSessionToken, isWellFormedSessionToken } from "./session-token";

type Db = PrismaClient | Prisma.TransactionClient;

/** Fallback when an org has no SecuritySettings row yet (schema default). */
export const DEFAULT_SESSION_TTL_MINUTES = 480;

export type SessionContext = {
  ip?: string | null;
  device?: string | null;
  /**
   * Whether to stamp `User.lastLoginAt`. True for a real sign-in (FR-2); false
   * for a rotation, which is not a new login — otherwise "last login" would
   * creep forward on every request and be useless for audit and for spotting a
   * dormant account.
   */
  stampLastLogin?: boolean;
  /**
   * Override the org's default session TTL — used by "remember me" to issue a
   * long-lived session. The Session ROW expiry is the real authority (every
   * request re-checks it), so a longer life here is honoured without touching
   * the JWT cookie.
   */
  ttlMinutesOverride?: number;
};

export type CreatedSession = {
  /** Raw token for the cookie — never persisted. */
  token: string;
  sessionId: string;
  expiresAt: Date;
  claims: SessionClaims;
};

export type ResolvedSession = {
  sessionId: string;
  expiresAt: Date;
  claims: SessionClaims;
};

export async function getSessionTtlMinutes(db: Db, orgId: string): Promise<number> {
  const settings = await db.securitySettings.findUnique({
    where: { orgId },
    select: { sessionTtlMinutes: true },
  });
  return settings?.sessionTtlMinutes ?? DEFAULT_SESSION_TTL_MINUTES;
}

/**
 * Issue a session for an already-authenticated user.
 *
 * Callers must have completed every authentication factor first — this function
 * asks no questions about credentials. `now` is injected so TTL behaviour is
 * testable without waiting.
 */
export async function createSession(
  db: Db,
  userId: string,
  ctx: SessionContext = {},
  now: Date = new Date(),
): Promise<CreatedSession | null> {
  const claims = await assembleClaims(db, userId);
  if (!claims) return null;

  const ttlMinutes = ctx.ttlMinutesOverride ?? (await getSessionTtlMinutes(db, claims.orgId));
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);

  const token = generateSessionToken();
  const session = await db.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      activePropertyId: claims.activePropertyId,
      ip: ctx.ip ?? null,
      device: ctx.device ?? null,
      expiresAt,
    },
    select: { id: true },
  });

  // FR-2: stamp lastLoginAt when a session is actually established — not on a
  // partial (password-only, 2FA-pending) attempt, and not on a rotation.
  if (ctx.stampLastLogin !== false) {
    await db.user.update({ where: { id: userId }, data: { lastLoginAt: now } });
  }

  return { token, sessionId: session.id, expiresAt, claims };
}

/**
 * Resolve a presented token to live claims, or null.
 *
 * Null covers every rejection case deliberately — expired, revoked, unknown,
 * deactivated user — because the caller's response is identical (sign in
 * again), and distinguishing them leaks information.
 */
export async function resolveSession(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<ResolvedSession | null> {
  if (!isWellFormedSessionToken(token)) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: {
      id: true,
      userId: true,
      activePropertyId: true,
      expiresAt: true,
      revokedAt: true,
    },
  });

  if (!session) return null;
  if (session.revokedAt !== null) return null; // force-logout is immediate
  if (session.expiresAt.getTime() <= now.getTime()) return null;

  // Rebuilt every request — this is FR-12's "no later than the next request".
  const claims = await assembleClaims(db, session.userId, session.activePropertyId);
  if (!claims) return null; // user deactivated or deleted mid-session

  // The active property may have dropped out of scope since it was chosen; keep
  // the row in step with the re-validated value.
  if (claims.activePropertyId !== session.activePropertyId) {
    await db.session.update({
      where: { id: session.id },
      data: { activePropertyId: claims.activePropertyId },
    });
  }

  return { sessionId: session.id, expiresAt: session.expiresAt, claims };
}

/**
 * Rotate: issue a new token and revoke the old row in one transaction.
 * security.md requires rotation; doing it atomically means a crash can never
 * leave the user with two live sessions or none.
 */
export async function rotateSession(
  db: PrismaClient,
  currentToken: string,
  ctx: SessionContext = {},
  now: Date = new Date(),
): Promise<CreatedSession | null> {
  const current = await resolveSession(db, currentToken, now);
  if (!current) return null;

  return db.$transaction(async (tx) => {
    await tx.session.update({
      where: { id: current.sessionId },
      data: { revokedAt: now },
    });
    return createSession(tx, current.claims.userId, { ...ctx, stampLastLogin: false }, now);
  });
}

/** Sign-out. Idempotent: revoking an already-revoked token is not an error. */
export async function revokeSession(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<void> {
  if (!isWellFormedSessionToken(token)) return;
  await db.session.updateMany({
    where: { tokenHash: hashSessionToken(token), revokedAt: null },
    data: { revokedAt: now },
  });
}

/**
 * Revoke every live session for a user — used by password reset (FR-6) and by
 * an administrator's force-logout.
 */
export async function revokeAllSessionsForUser(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const { count } = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
  return count;
}

/**
 * Persist the switched active property (FR-27). Validates scope first: a user
 * must never be able to point their session at a property they cannot access.
 */
export async function setActiveProperty(
  db: Db,
  sessionId: string,
  propertyId: string,
  claims: SessionClaims,
): Promise<boolean> {
  if (!claims.accessiblePropertyIds.includes(propertyId)) return false;
  await db.session.update({ where: { id: sessionId }, data: { activePropertyId: propertyId } });
  return true;
}
