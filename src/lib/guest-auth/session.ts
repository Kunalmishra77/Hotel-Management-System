/**
 * Guest web session — DB-backed and revocable, fully isolated from staff auth
 * (Phase 2). The random token lives only in an httpOnly cookie; the DB stores
 * sha256(token) in `GuestSession.tokenHash`. Every request re-checks
 * `revokedAt`/`expiresAt`, so logout is immediate (same posture as staff
 * `Session`, security.md). A guest holds no role and no property scope — nothing
 * here ever grants access inside `(dashboard)`.
 */
import "server-only";
import { cookies, headers } from "next/headers";
import {
  generateSessionToken,
  hashSessionToken,
  isWellFormedSessionToken,
} from "@/lib/auth/session-token";
import { db } from "@/lib/db";

export const GUEST_SESSION_COOKIE = "wp_guest_session";
/** Consumer app: a long-lived session, revocable server-side at any time. */
export const GUEST_SESSION_TTL_DAYS = 30;

export type GuestPrincipal = {
  sessionId: string;
  accountId: string;
  guestId: string;
  orgId: string;
};

function cookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}

/** Best-effort request context for audit/session rows (never trusted for authz). */
async function requestContext(): Promise<{ ip: string | null; device: string | null }> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  const device = h.get("user-agent") ?? null;
  return { ip, device };
}

/**
 * Issue a session for an already-authenticated guest account and set the cookie.
 * Callers must have verified credentials/OTP first — this asks no questions.
 */
export async function createGuestSession(accountId: string, now: Date = new Date()): Promise<void> {
  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + GUEST_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const { ip, device } = await requestContext();

  await db.unscoped().guestSession.create({
    data: { guestAccountId: accountId, tokenHash: hashSessionToken(token), ip, device, expiresAt },
    select: { id: true },
  });
  await db.unscoped().guestAccount.update({ where: { id: accountId }, data: { lastLoginAt: now } });

  (await cookies()).set(GUEST_SESSION_COOKIE, token, cookieOptions(expiresAt));
}

/**
 * Resolve the cookie to a live guest principal, or null. Null covers every
 * rejection (expired, revoked, unknown, deactivated) — the caller's response is
 * identical, and distinguishing them leaks information.
 */
export async function resolveGuestSession(now: Date = new Date()): Promise<GuestPrincipal | null> {
  const token = (await cookies()).get(GUEST_SESSION_COOKIE)?.value;
  if (!token || !isWellFormedSessionToken(token)) return null;

  const session = await db.unscoped().guestSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      account: { select: { id: true, guestId: true, orgId: true, isActive: true, deletedAt: true } },
    },
  });

  if (!session) return null;
  if (session.revokedAt !== null) return null;
  if (session.expiresAt.getTime() <= now.getTime()) return null;
  if (!session.account.isActive || session.account.deletedAt !== null) return null;

  return {
    sessionId: session.id,
    accountId: session.account.id,
    guestId: session.account.guestId,
    orgId: session.account.orgId,
  };
}

/** Sign-out: revoke the row (immediate) and clear the cookie. Idempotent. */
export async function revokeGuestSession(now: Date = new Date()): Promise<void> {
  const store = await cookies();
  const token = store.get(GUEST_SESSION_COOKIE)?.value;
  if (token && isWellFormedSessionToken(token)) {
    await db.unscoped().guestSession.updateMany({
      where: { tokenHash: hashSessionToken(token), revokedAt: null },
      data: { revokedAt: now },
    });
  }
  store.delete(GUEST_SESSION_COOKIE);
}
