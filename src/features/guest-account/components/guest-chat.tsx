"use client";
/**
 * Guest ↔ reception chat panel (architecture v2 · Phase 6). Shown on the in-house
 * "My stay" page. Renders the thread and sends a new message via sendGuestMessage;
 * refreshes to pull reception's replies.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { sendGuestMessage } from "../chat-actions";
import type { StayMessage } from "../stay-queries";

const time = (d: Date): string => new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

export function GuestChat({ messages }: { messages: StayMessage[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  function send() {
    const text = body.trim();
    if (!text) return;
    setError(null);
    start(async () => {
      const res = await sendGuestMessage({ body: text });
      if (!res.ok) return setError(res.error.message);
      setBody("");
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <MessagesSquare className="size-4 text-primary" aria-hidden="true" />
        <span className="text-sm font-semibold">Chat with reception</span>
      </div>

      <div className="flex max-h-80 flex-col gap-2 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Send a message — the front desk replies here.</p>
        ) : (
          messages.map((m) => {
            const mine = m.sender === "GUEST";
            return (
              <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm", mine ? "bg-primary text-primary-foreground" : "bg-muted")}>
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={cn("mt-0.5 text-[10px]", mine ? "text-primary-foreground/70" : "text-muted-foreground")}>
                    {mine ? "You" : "Reception"} · {time(m.createdAt)}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-center gap-2 border-t p-3">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Message the front desk…"
          maxLength={1000}
          className="min-h-touch flex-1 rounded-full border bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button size="icon" onClick={send} disabled={pending || !body.trim()} aria-label="Send message" className="shrink-0 rounded-full">
          <Send className="size-4" />
        </Button>
      </div>
      {error && <p className="px-4 pb-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
