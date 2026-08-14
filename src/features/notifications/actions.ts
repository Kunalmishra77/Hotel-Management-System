"use server";
/**
 * Notification mutations (Phase 3). Read-state only, scoped to the caller's own
 * rows — a user can never mark another user's notification (the updateMany filter
 * includes recipientUserId, so a foreign id simply matches nothing).
 */
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { type Result, toResult } from "@/lib/result";
import { tickOutboxOnce } from "@/lib/events/in-process-dispatch";
import { listMyNotifications, unreadNotificationCount, type NotificationItem } from "./queries";

/**
 * Bell payload for the client (unread badge + recent list). Read-only — but it
 * also runs one best-effort outbox dispatch tick first, so in a single-process
 * deploy (no separate worker) domain events actually get consumed while staff
 * are active. The tick is guarded/caught; it never blocks or breaks the read.
 */
export async function fetchNotifications(): Promise<{ unread: number; items: NotificationItem[] }> {
  await tickOutboxOnce();
  const [unread, items] = await Promise.all([unreadNotificationCount(), listMyNotifications(15)]);
  return { unread, items };
}

export async function markNotificationRead(id: string): Promise<Result<{ ok: true }>> {
  return toResult(async () => {
    const user = await requireUser();
    await db.unscoped().notification.updateMany({
      where: { id, recipientUserId: user.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  });
}

export async function markAllNotificationsRead(): Promise<Result<{ count: number }>> {
  return toResult(async () => {
    const user = await requireUser();
    const { count } = await db.unscoped().notification.updateMany({
      where: { recipientUserId: user.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { count };
  });
}
