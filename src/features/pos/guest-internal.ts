/**
 * Shared internals for the PUBLIC guest QR ordering surface — 19 addendum
 * (FR-19/20/26). NOT a "use server" module.
 *
 * The public page/action has NO session, so it uses the unscoped client and
 * derives everything from the room token. `resolveRoomToken` is the single gate:
 * it returns a target only when the token maps to an active room that is CURRENTLY
 * occupied (an IN_HOUSE reservation) and whose property has a resolvable
 * room-dining outlet. Anything else → null (the caller shows a generic
 * "unavailable", never leaking why — FR-26).
 */
import { db } from "@/lib/db";
import { newRequestId, runWithContext, SYSTEM_USER_ID } from "@/lib/context";

// Rate limit (FR-21/26) — per-token fixed window, in-process (booking-engine
// pattern; tech-stack.md forbids Redis without an ADR, and a single app instance
// suffices at this scale). Guards the public submit against a flood from anyone
// holding a room's QR.
type Bucket = { count: number; resetAt: number };
const submitBuckets = new Map<string, Bucket>();
const SUBMIT_LIMIT = 8;
const SUBMIT_WINDOW_MS = 60_000;

/** Consume one guest-submit token for a room token. False ⇒ rate-limited. */
export function checkGuestSubmitRate(token: string, now: number = Date.now()): boolean {
  const key = `submit:${token}`;
  const b = submitBuckets.get(key);
  if (!b || b.resetAt <= now) {
    submitBuckets.set(key, { count: 1, resetAt: now + SUBMIT_WINDOW_MS });
    return true;
  }
  if (b.count >= SUBMIT_LIMIT) return false;
  b.count += 1;
  return true;
}

/** Test seam — clear the guest rate-limit buckets. */
export function resetGuestRateLimits(): void {
  submitBuckets.clear();
}

export type ResolvedRoomToken = {
  orgId: string;
  propertyId: string;
  roomId: string;
  roomNumber: string;
  outletId: string;
  reservationId: string;
};

/** Resolve a room QR token to its ordering target, or null if ordering is
 *  unavailable (unknown token / inactive room / not occupied / no outlet). */
export async function resolveRoomToken(token: string): Promise<ResolvedRoomToken | null> {
  if (!token) return null;
  const client = db.unscoped();

  const room = await client.room.findFirst({
    where: { orderToken: token, isActive: true },
    select: { id: true, number: true, propertyId: true, property: { select: { orgId: true } } },
  });
  if (!room) return null;

  // Occupied-gate: a current IN_HOUSE reservation allocated to this room.
  const reservation = await client.reservation.findFirst({
    where: { propertyId: room.propertyId, status: "IN_HOUSE", allocations: { some: { roomId: room.id } } },
    select: { id: true },
  });
  if (!reservation) return null;

  // Room-dining outlet: the flagged one, else the sole outlet, else none.
  const outlets = await client.posOutlet.findMany({
    where: { propertyId: room.propertyId },
    select: { id: true, isRoomDining: true },
  });
  const dining = outlets.find((o) => o.isRoomDining) ?? (outlets.length === 1 ? outlets[0] : null);
  if (!dining) return null;

  return {
    orgId: room.property.orgId,
    propertyId: room.propertyId,
    roomId: room.id,
    roomNumber: room.number,
    outletId: dining.id,
    reservationId: reservation.id,
  };
}

/**
 * Bind a request context for a guest (unauthenticated) action so writeAudit/emit
 * have an org. userId = SYSTEM_USER_ID (writeAudit nulls it — no User FK); the
 * `device: "guest-qr"` field marks the row as a guest self-order.
 */
export function withGuestContext<T>(orgId: string, propertyId: string, fn: () => Promise<T>): Promise<T> {
  return runWithContext(
    {
      orgId,
      userId: SYSTEM_USER_ID,
      propertyScope: { kind: "PROPERTIES", propertyIds: [propertyId] },
      activePropertyId: propertyId,
      requestId: newRequestId(),
      ip: null,
      device: "guest-qr",
    },
    fn,
  );
}
