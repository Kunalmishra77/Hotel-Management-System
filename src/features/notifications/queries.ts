import "server-only";
/**
 * Notification reads (Phase 3). ALWAYS scoped to the caller's own rows
 * (`recipientUserId = me`) — never a client-supplied id, never another user's
 * notifications. Not a property-scoped model, so we filter explicitly.
 */
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
};

/** Unread count for the bell badge. */
export async function unreadNotificationCount(): Promise<number> {
  const user = await requireUser();
  return db.unscoped().notification.count({
    where: { recipientUserId: user.userId, readAt: null },
  });
}

/** The caller's most recent notifications (read + unread), newest first. */
export async function listMyNotifications(limit = 20): Promise<NotificationItem[]> {
  const user = await requireUser();
  return db.unscoped().notification.findMany({
    where: { recipientUserId: user.userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
    select: { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true },
  });
}
