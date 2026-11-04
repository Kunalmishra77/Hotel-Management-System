"use client";

/**
 * "Open" popup for one sent message — the owner/manager sees exactly what went to
 * the guest: an email as an envelope (from / to / subject / body), a WhatsApp or
 * SMS as a chat bubble, plus who it went to, when, why (automatic or sent by a
 * staff member) and the status trail. A sandbox send is labelled plainly as "not
 * actually sent" so "Delivered" never misleads while a channel isn't live.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMessageDetail, type MessageDetail } from "../message-detail";
import { CHANNEL_LABEL, messageTitle, statusLabel } from "./message-labels";

const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

export function MessageDetailDialog({ messageId, onClose }: { messageId: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setError(null);
    if (!messageId) return;
    let live = true;
    getMessageDetail(messageId).then((r) => {
      if (!live) return;
      if (r.ok) setDetail(r.data);
      else setError(r.error.message);
    });
    return () => { live = false; };
  }, [messageId]);

  useEffect(() => {
    if (!messageId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [messageId, onClose]);

  if (!messageId) return null;
  const d = detail;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div role="dialog" aria-modal="true" aria-label="Message details" className="relative max-h-[90vh] w-full overflow-y-auto rounded-t-xl border bg-background p-4 shadow-lg sm:max-w-xl sm:rounded-xl" data-testid="message-detail">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{d ? `${CHANNEL_LABEL[d.channel] ?? d.channel} · ${messageTitle(d.templateKey, d.category)}` : "Message"}</h2>
            {d && <p className="text-sm text-muted-foreground">{fmtTime(d.createdAt)}{d.propertyName ? ` · ${d.propertyName}` : ""}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X className="size-4" /></Button>
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!d && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

        {d && (
          <div className="space-y-4">
            {d.sandbox && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-800 dark:text-amber-300" data-testid="message-sandbox">
                <b>Test mode — this message was not actually sent.</b> {CHANNEL_LABEL[d.channel] ?? d.channel} is not connected yet, so it was only recorded here. Once the channel is switched live in Settings → Integrations, messages go to the guest for real.
              </p>
            )}

            <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">To</dt>
              <dd>
                {d.guestName ? (d.guestId ? <Link href={`/guests/${d.guestId}`} className="font-medium underline-offset-2 hover:underline">{d.guestName}</Link> : <span className="font-medium">{d.guestName}</span>) : "—"}
                <span className="text-muted-foreground"> · {d.toAddress}</span>
              </dd>
              {d.fromAddress && (<><dt className="text-muted-foreground">From</dt><dd className="break-all">{d.fromAddress}</dd></>)}
              <dt className="text-muted-foreground">Sent by</dt><dd>{d.sentBy ? `${d.sentBy} (by hand)` : "Automatic (system)"}</dd>
              {d.scheduledFor && (<><dt className="text-muted-foreground">Scheduled</dt><dd>{fmtTime(d.scheduledFor)}</dd></>)}
              <dt className="text-muted-foreground">Status</dt>
              <dd className={d.status === "FAILED" ? "font-medium text-destructive" : d.sandbox ? "font-medium text-amber-700 dark:text-amber-400" : "font-medium"}>
                {statusLabel(d.status, d.sandbox)}{d.error ? ` — ${d.error}` : ""}{d.attempts > 1 ? ` · ${d.attempts} tries` : ""}
              </dd>
            </dl>

            {d.body === null ? (
              <p className="rounded-md border p-3 text-sm text-muted-foreground">No message text — it could not be prepared (a required detail was missing), so nothing was sent.</p>
            ) : d.channel === "EMAIL" ? (
              <div className="overflow-hidden rounded-md border" data-testid="message-email">
                <div className="border-b bg-muted/40 px-3 py-2 text-sm"><span className="text-muted-foreground">Subject: </span><span className="font-medium">{d.subject}</span></div>
                <div className="whitespace-pre-wrap break-words p-3 text-sm leading-relaxed">{d.body}</div>
              </div>
            ) : (
              <div className="rounded-md bg-muted/40 p-3" data-testid="message-chat">
                <div className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-lg rounded-tr-none bg-emerald-100 px-3 py-2 text-sm text-emerald-950 dark:bg-emerald-900/50 dark:text-emerald-50">{d.body}</div>
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-sm font-medium">What happened</p>
              <ol className="space-y-1 border-l pl-3 text-sm">
                {d.steps.map((s, i) => (
                  <li key={i} className="flex flex-wrap justify-between gap-x-3">
                    <span>{statusLabel(s.status, d.sandbox)}{s.by ? ` · ${s.by}` : ""}</span>
                    <span className="text-muted-foreground tabular-nums">{fmtTime(s.at)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
