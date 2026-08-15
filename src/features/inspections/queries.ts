import "server-only";
/**
 * Room inspection reads (architecture v2 · Phase 5). The inspection queue = rooms
 * currently in HOUSEKEEPING status (cleaned, awaiting sign-off), plus the recent
 * inspection log. Property-scoped; `housekeeping:update`.
 */
import { db } from "@/lib/db";
import type { SessionClaims } from "@/lib/auth/claims";

export type InspectionQueueRoom = { roomId: string; number: string };
export type InspectionLogRow = {
  id: string;
  roomNumber: string;
  status: string;
  defectNotes: string | null;
  inspectedAt: Date | null;
  createdAt: Date;
};

export async function listInspectionQueue(user: SessionClaims, propertyId: string): Promise<InspectionQueueRoom[]> {
  const rooms = await db.scoped(user).room.findMany({
    where: { propertyId, status: "HOUSEKEEPING" },
    orderBy: { number: "asc" },
    take: 200,
    select: { id: true, number: true },
  });
  return rooms.map((r) => ({ roomId: r.id, number: r.number }));
}

export async function listRecentInspections(user: SessionClaims, propertyId: string): Promise<InspectionLogRow[]> {
  const rows = await db.scoped(user).roomInspection.findMany({
    where: { propertyId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, roomId: true, status: true, defectNotes: true, inspectedAt: true, createdAt: true },
  });
  if (rows.length === 0) return [];
  const roomIds = [...new Set(rows.map((r) => r.roomId))];
  const rooms = await db.unscoped().room.findMany({ where: { id: { in: roomIds } }, select: { id: true, number: true } });
  const numberById = new Map(rooms.map((r) => [r.id, r.number]));
  return rows.map((r) => ({
    id: r.id,
    roomNumber: numberById.get(r.roomId) ?? r.roomId,
    status: r.status,
    defectNotes: r.defectNotes,
    inspectedAt: r.inspectedAt,
    createdAt: r.createdAt,
  }));
}
