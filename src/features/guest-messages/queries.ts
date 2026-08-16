import "server-only";
/**
 * Staff reads for the guest-chat inbox (architecture v2 · Phase 6). Scoped to the
 * caller's accessible properties (GuestMessage carries propertyId; we filter
 * explicitly). `request:manage` — the same front-desk role that works the requests
 * inbox handles guest chat.
 */
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export type MessageThread = {
  reservationId: string;
  code: string;
  guestName: string;
  lastBody: string;
  lastSender: string;
  lastAt: Date;
};
export type ThreadMessage = { id: string; sender: string; body: string; createdAt: Date };

/** One row per reservation with messages, newest-active first. */
export async function listMessageThreads(): Promise<MessageThread[]> {
  const user = await requireUser();
  if (!hasPermission(user, "request:manage") || user.accessiblePropertyIds.length === 0) return [];

  const rows = await db.unscoped().guestMessage.findMany({
    where: { propertyId: { in: [...user.accessiblePropertyIds] } },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: {
      reservationId: true, body: true, sender: true, createdAt: true,
      reservation: { select: { code: true, guest: { select: { fullName: true } } } },
    },
  });

  const seen = new Set<string>();
  const threads: MessageThread[] = [];
  for (const r of rows) {
    if (seen.has(r.reservationId)) continue;
    seen.add(r.reservationId);
    threads.push({
      reservationId: r.reservationId,
      code: r.reservation.code,
      guestName: r.reservation.guest.fullName,
      lastBody: r.body,
      lastSender: r.sender,
      lastAt: r.createdAt,
    });
  }
  return threads;
}

/** The full thread for one reservation, if it is in the caller's scope. */
export async function getThread(reservationId: string): Promise<{ code: string; guestName: string; messages: ThreadMessage[] } | null> {
  const user = await requireUser();
  if (!hasPermission(user, "request:manage")) return null;

  const reservation = await db.unscoped().reservation.findFirst({
    where: { id: reservationId, propertyId: { in: [...user.accessiblePropertyIds] } },
    select: { code: true, guest: { select: { fullName: true } } },
  });
  if (!reservation) return null;

  const messages = await db.unscoped().guestMessage.findMany({
    where: { reservationId },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { id: true, sender: true, body: true, createdAt: true },
  });
  return { code: reservation.code, guestName: reservation.guest.fullName, messages };
}
