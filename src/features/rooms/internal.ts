/**
 * Shared internals for the room actions.
 *
 * NOT a "use server" module — everything exported from one of those becomes a
 * callable endpoint. Keeping helpers here also holds each action file under the
 * ~300-line limit (coding-standards.md).
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";
import type { SessionClaims } from "@/lib/auth/claims";

/**
 * Rooms and categories ARE property-scoped, so this uses the scoped client —
 * unlike 01, which had to reach for `unscoped` because `Property` is the root
 * of the tenancy tree. Here the extension does the filtering, and a query that
 * forgets a `where` is still confined (00 FR-8).
 */
export function roomDb(user: SessionClaims) {
  return db.scoped(user);
}

export function withRoomContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
  return runWithContext(
    {
      orgId: user.orgId,
      userId: user.userId,
      propertyScope: user.propertyScope,
      activePropertyId: user.activePropertyId,
      requestId: newRequestId(),
      ip: null,
      device: null,
    },
    fn,
  );
}

export function isUniqueViolation(e: unknown, target?: string): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  if (!target) return true;
  const fields = (e.meta?.target ?? []) as string[] | string;
  return Array.isArray(fields) ? fields.includes(target) : String(fields).includes(target);
}

/** The roles a caller holds — the state machine gates transitions on these. */
export function rolesOf(user: SessionClaims) {
  return user.roleAssignments.map((r) => r.role);
}

export const ROOM_SELECT = {
  id: true,
  propertyId: true,
  number: true,
  status: true,
  isActive: true,
  floorId: true,
  categoryId: true,
} as const;

export const CATEGORY_SELECT = {
  id: true,
  propertyId: true,
  name: true,
  baseRatePaise: true,
  maxAdults: true,
  maxChildren: true,
  hsnSac: true,
  gstBps: true,
} as const;
