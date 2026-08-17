import type { Metadata } from "next";
import Link from "next/link";
import { MessagesSquare, ArrowRight, Reply } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { listMessageThreads } from "@/features/guest-messages/queries";
import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Guest messages" };

const ago = (d: Date): string => {
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
};

/**
 * Reception · Guest messages inbox (architecture v2 · Phase 6). One row per chat
 * thread across the caller's properties; open one to read + reply. `request:manage`.
 */
export default async function MessagesPage() {
  await requirePermission("request:manage");
  const threads = await listMessageThreads();

  const awaiting = threads.filter((t) => t.lastSender === "GUEST").length;

  return (
    <div className="mx-auto w-full max-w-4xl px-1 py-1">
      <PageHeader title="Guest messages" description="Chat threads from checked-in guests." />

      <div className="mt-6 grid grid-cols-2 gap-3 sm:max-w-md">
        <KpiCard label="Active threads" value={threads.length} icon={<MessagesSquare />} hint="Conversations" />
        <KpiCard label="Awaiting reply" value={awaiting} icon={<Reply />} hint="Guest wrote last" className={awaiting > 0 ? "border-warning/40" : undefined} />
      </div>

      {threads.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed bg-muted/30 p-12 text-center">
          <MessagesSquare className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">No messages</p>
          <p className="mt-1 text-sm text-muted-foreground">Guest chats will appear here.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-2.5">
          {threads.map((t) => (
            <li key={t.reservationId}>
              <Link href={`/messages/${t.reservationId}`}>
                <Card className="u-lift flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{t.guestName}</span>
                      <span className="font-mono text-xs text-muted-foreground">{t.code}</span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {t.lastSender === "STAFF" ? "You: " : ""}{t.lastBody}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">{ago(t.lastAt)}</span>
                    <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
                  </span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
