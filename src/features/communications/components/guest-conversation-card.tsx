"use client";

/**
 * #24 — a guest's communication history ("Conversation"): every automated/manual
 * message sent to them across channels, newest first. Tap one to open exactly what
 * was sent. Read-only; addresses are already masked by the query. Rendered on the
 * guest profile.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageDetailDialog } from "./message-detail-dialog";
import { CHANNEL_LABEL, messageTitle, statusLabel } from "./message-labels";

type GuestMessage = {
  id: string;
  channel: string;
  category: string | null;
  templateKey: string | null;
  toAddress: string;
  status: string;
  sandbox: boolean;
  createdAt: Date;
};

const tone = (m: GuestMessage) =>
  m.status === "FAILED" ? "text-destructive" : m.sandbox ? "text-amber-700 dark:text-amber-400" : m.status === "DELIVERED" || m.status === "READ" ? "text-success" : "text-muted-foreground";

export function GuestConversationCard({ messages }: { messages: GuestMessage[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Conversation · messages sent</CardTitle></CardHeader>
      <CardContent>
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages sent to this guest yet. Booking, check-in, check-out and follow-up messages appear here automatically.</p>
        ) : (
          <ul className="divide-y rounded-md border" data-testid="guest-conversation">
            {messages.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => setOpen(m.id)} className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 p-3 text-left text-sm hover:bg-muted/50">
                  <div className="min-w-0">
                    <p className="font-medium">{CHANNEL_LABEL[m.channel] ?? m.channel} · {messageTitle(m.templateKey, m.category)}</p>
                    <p className="text-xs text-muted-foreground">{m.toAddress} · {new Date(m.createdAt).toLocaleString("en-IN")}</p>
                  </div>
                  <span className={`text-xs font-medium ${tone(m)}`}>{statusLabel(m.status, m.sandbox)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <MessageDetailDialog messageId={open} onClose={() => setOpen(null)} />
      </CardContent>
    </Card>
  );
}
