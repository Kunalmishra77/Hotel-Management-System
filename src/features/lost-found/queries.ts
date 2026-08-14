import "server-only";
/**
 * Lost & Found reads (Phase 7). Scoped to the caller's active property. Active
 * (STORED) items first, then recently resolved.
 */
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export type LostItem = {
  id: string;
  description: string;
  roomNumber: string | null;
  foundOn: Date;
  status: string;
  claimantName: string | null;
  resolvedOn: Date | null;
  notes: string | null;
};

/** Lost & Found for the caller's active property (empty if none/unpermitted). */
export async function listLostAndFound(): Promise<LostItem[]> {
  const user = await requireUser();
  const propertyId = user.activePropertyId;
  if (!propertyId || !hasPermission(user, "housekeeping:update")) return [];

  const rows = await db.unscoped().lostAndFoundItem.findMany({
    where: { propertyId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }], // STORED (< CLAIMED/DISPOSED) first
    take: 100,
    select: {
      id: true, description: true, roomId: true, foundOn: true, status: true,
      claimantName: true, resolvedOn: true, notes: true,
    },
  });
  if (rows.length === 0) return [];

  const roomIds = [...new Set(rows.flatMap((r) => (r.roomId ? [r.roomId] : [])))];
  const rooms = await db.unscoped().room.findMany({ where: { id: { in: roomIds } }, select: { id: true, number: true } });
  const numberById = new Map(rooms.map((r) => [r.id, r.number]));

  return rows.map((r) => ({
    id: r.id,
    description: r.description,
    roomNumber: r.roomId ? (numberById.get(r.roomId) ?? null) : null,
    foundOn: r.foundOn,
    status: r.status,
    claimantName: r.claimantName,
    resolvedOn: r.resolvedOn,
    notes: r.notes,
  }));
}
