/**
 * Shared internals for field-staff location tracking — 09 addendum (FR-17/18).
 * NOT a "use server" module.
 *
 * The tracker page + ping endpoint are PUBLIC (drivers have no login); the
 * `trackingToken` IS the credential. `recordFieldPing` uses the unscoped client
 * and derives the staff/property from the token — nothing trusts the request
 * body beyond the coordinates. Pings are rate-limited per token, in-process
 * (guest-QR pattern; no Redis per tech-stack.md).
 */
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { DomainError, ErrorCode } from "@/lib/errors";
import { fieldPingSchema } from "./schema";

/** How old a last-known ping may be before the map shows a staff member "stale". */
export const FIELD_STALE_MS = 10 * 60_000; // 10 minutes (FR-19)

export function generateTrackingToken(): string {
  return randomBytes(16).toString("hex");
}

// Per-token fixed-window rate limit (FR-18) — a device pinging every few minutes
// needs only a handful per minute; this caps abuse of a leaked token.
type Bucket = { count: number; resetAt: number };
const pingBuckets = new Map<string, Bucket>();
const PING_LIMIT = 12;
const PING_WINDOW_MS = 60_000;

export function checkPingRate(token: string, now: number = Date.now()): boolean {
  const b = pingBuckets.get(token);
  if (!b || b.resetAt <= now) {
    pingBuckets.set(token, { count: 1, resetAt: now + PING_WINDOW_MS });
    return true;
  }
  if (b.count >= PING_LIMIT) return false;
  b.count += 1;
  return true;
}

/** Test seam — clear the ping rate-limit buckets. */
export function resetFieldRateLimits(): void {
  pingBuckets.clear();
}

export type ResolvedTrackingToken = { staffId: string; propertyId: string; staffName: string };

/**
 * Resolve a tracking token to its field-staff target, or null if tracking is
 * unavailable (unknown token / not field staff / deactivated). The caller shows
 * a generic "link inactive", never why.
 */
export async function resolveTrackingToken(token: string): Promise<ResolvedTrackingToken | null> {
  if (!token) return null;
  const staff = await db.unscoped().staff.findFirst({
    where: { trackingToken: token, isFieldStaff: true, isActive: true, deletedAt: null },
    select: { id: true, propertyId: true, name: true },
  });
  return staff ? { staffId: staff.id, propertyId: staff.propertyId, staffName: staff.name } : null;
}

/**
 * Record one on-duty location ping. Token-authed + rate-limited; no session.
 * Returns void on success; throws a DomainError the route maps to a status.
 */
export async function recordFieldPing(input: unknown): Promise<void> {
  const data = fieldPingSchema.parse(input);
  const target = await resolveTrackingToken(data.token);
  if (!target) throw new DomainError(ErrorCode.FORBIDDEN, "This tracking link is not active.");
  if (!checkPingRate(data.token)) throw new DomainError(ErrorCode.RATE_LIMITED, "Too many pings; slow down.");

  await db.unscoped().fieldStaffPing.create({
    data: {
      staffId: target.staffId,
      propertyId: target.propertyId,
      lat: data.lat,
      lng: data.lng,
      accuracyM: data.accuracyM ?? null,
      capturedAt: new Date(),
    },
  });
}
