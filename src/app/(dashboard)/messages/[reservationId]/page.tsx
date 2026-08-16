import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { getThread } from "@/features/guest-messages/queries";
import { StaffReply } from "@/features/guest-messages/components/staff-reply";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Guest chat" };

const time = (d: Date): string => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Reception · one guest chat thread — read + reply (architecture v2 · Phase 6). */
export default async function ThreadPage({ params }: { params: Promise<{ reservationId: string }> }) {
  await requirePermission("request:manage");
  const { reservationId } = await params;
  const thread = await getThread(reservationId);
  if (!thread) notFound();

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-1 py-1">
      <Link href="/messages" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        <ArrowLeft className="size-3.5" aria-hidden="true" /> All messages
      </Link>

      <div className="rounded-2xl border bg-card shadow-sm">
        <div className="border-b px-4 py-3">
          <p className="font-semibold">{thread.guestName}</p>
          <p className="font-mono text-xs text-muted-foreground">{thread.code}</p>
        </div>

        <div className="flex max-h-[60dvh] flex-col gap-2 overflow-y-auto p-4">
          {thread.messages.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No messages yet.</p>
          ) : (
            thread.messages.map((m) => {
              const staff = m.sender === "STAFF";
              return (
                <div key={m.id} className={cn("flex", staff ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm", staff ? "bg-primary text-primary-foreground" : "bg-muted")}>
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <p className={cn("mt-0.5 text-[10px]", staff ? "text-primary-foreground/70" : "text-muted-foreground")}>
                      {staff ? "Reception" : thread.guestName} · {time(m.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="border-t p-3">
          <StaffReply reservationId={reservationId} />
        </div>
      </div>
    </div>
  );
}
