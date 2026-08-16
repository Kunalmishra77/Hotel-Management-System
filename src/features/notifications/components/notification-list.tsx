"use client";
/**
 * Notification centre list (architecture v2 · Phase 7). Renders the caller's
 * notifications; clicking one marks it read and follows its link, and a header
 * action marks everything read.
 */
import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCheck, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { markNotificationRead, markAllNotificationsRead } from "../actions";
import type { NotificationItem } from "../queries";

const ago = (d: Date): string => {
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
};

export function NotificationList({ items }: { items: NotificationItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const anyUnread = items.some((i) => i.readAt === null);

  function readOne(id: string) {
    start(async () => { await markNotificationRead(id); router.refresh(); });
  }
  function readAll() {
    start(async () => { await markAllNotificationsRead(); router.refresh(); });
  }

  if (items.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-dashed bg-muted/30 p-10 text-center">
        <Bell className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium">No notifications</p>
        <p className="mt-1 text-sm text-muted-foreground">Operational alerts will show up here.</p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      {anyUnread && (
        <div className="mb-3 flex justify-end">
          <Button size="sm" variant="outline" onClick={readAll} disabled={pending}><CheckCheck className="size-4" /> Mark all read</Button>
        </div>
      )}
      <ul className="space-y-2">
        {items.map((n) => {
          const unread = n.readAt === null;
          const body = (
            <div className={cn("flex items-start gap-3 rounded-xl border p-4 shadow-sm transition", unread ? "bg-primary/5 border-primary/20" : "bg-card")}>
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", unread ? "bg-primary" : "bg-transparent")} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{n.title}</p>
                {n.body ? <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p> : null}
                <p className="mt-1 text-xs text-muted-foreground">{ago(n.createdAt)}</p>
              </div>
            </div>
          );
          return (
            <li key={n.id}>
              {n.link ? (
                <Link href={n.link} onClick={() => unread && readOne(n.id)}>{body}</Link>
              ) : (
                <button type="button" className="w-full text-left" onClick={() => unread && readOne(n.id)} disabled={pending}>{body}</button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
