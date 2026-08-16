"use client";
/** Reception reply box for a guest chat thread (architecture v2 · Phase 6). */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { replyToGuest } from "../actions";

export function StaffReply({ reservationId }: { reservationId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  function send() {
    const text = body.trim();
    if (!text) return;
    setError(null);
    start(async () => {
      const res = await replyToGuest({ reservationId, body: text });
      if (!res.ok) return setError(res.error.message);
      setBody("");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <input
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        placeholder="Reply to the guest…"
        maxLength={1000}
        className="min-h-touch flex-1 rounded-full border bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Button size="icon" onClick={send} disabled={pending || !body.trim()} aria-label="Send reply" className="shrink-0 rounded-full">
        <Send className="size-4" />
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
