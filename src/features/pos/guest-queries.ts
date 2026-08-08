/**
 * Public read for the guest QR page — 19 addendum (FR-20). Menu DATA only: no
 * PII, no folio, no other room's data. Returns null when ordering is unavailable
 * (the page renders a generic message — FR-26).
 */
import { db } from "@/lib/db";
import { resolveRoomToken } from "./guest-internal";

export type GuestMenuItem = { id: string; name: string; ratePaise: number; gstBps: number };
export type GuestMenu = {
  roomNumber: string;
  outletId: string;
  items: GuestMenuItem[];
};

export async function getGuestMenu(token: string): Promise<GuestMenu | null> {
  const target = await resolveRoomToken(token);
  if (!target) return null;

  const items = await db.unscoped().menuItem.findMany({
    where: { outletId: target.outletId, isActive: true },
    select: { id: true, name: true, ratePaise: true, gstBps: true },
    orderBy: { name: "asc" },
  });

  return { roomNumber: target.roomNumber, outletId: target.outletId, items };
}
