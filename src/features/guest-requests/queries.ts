import "server-only";
/**
 * Staff reads for the guest-request inbox (Phase 4). Scoped to the caller's
 * accessible properties (GuestRequest is not a property-scoped model, so we filter
 * explicitly). Active requests first.
 */
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { ACTIVE_REQUEST_STATUSES } from "@/features/guest-account/domain/request-kind";

export type StaffRequest = {
  id: string;
  kind: string;
  detail: string;
  status: string;
  roomNumber: string | null;
  propertyId: string;
  createdAt: Date;
};

/** Open in-room requests across the caller's properties. Empty if unpermitted. */
export async function listGuestRequests(): Promise<StaffRequest[]> {
  const user = await requireUser();
  if (!hasPermission(user, "request:manage") || user.accessiblePropertyIds.length === 0) return [];

  const rows = await db.unscoped().guestRequest.findMany({
    where: {
      propertyId: { in: [...user.accessiblePropertyIds] },
      status: { in: [...ACTIVE_REQUEST_STATUSES] },
    },
    orderBy: { createdAt: "asc" }, // oldest-waiting first
    take: 100,
    select: { id: true, kind: true, detail: true, status: true, createdAt: true, propertyId: true, roomId: true },
  });
  if (rows.length === 0) return [];

  const roomIds = [...new Set(rows.flatMap((r) => (r.roomId ? [r.roomId] : [])))];
  const rooms = await db.unscoped().room.findMany({ where: { id: { in: roomIds } }, select: { id: true, number: true } });
  const numberById = new Map(rooms.map((r) => [r.id, r.number]));

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    detail: r.detail,
    status: r.status,
    roomNumber: r.roomId ? (numberById.get(r.roomId) ?? null) : null,
    propertyId: r.propertyId,
    createdAt: r.createdAt,
  }));
}
