import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { listMyNotifications } from "@/features/notifications/queries";
import { NotificationList } from "@/features/notifications/components/notification-list";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notifications" };

/**
 * Notification centre (architecture v2 · Phase 7). Every role's own operational
 * alerts in one place — the full view behind the header bell. Scoped to the caller.
 */
export default async function NotificationsPage() {
  await requireUser();
  const items = await listMyNotifications(50);

  return (
    <div className="mx-auto w-full max-w-2xl px-1 py-1">
      <PageHeader title="Notifications" description="Your operational alerts." />
      <NotificationList items={items} />
    </div>
  );
}
