"use client";

/**
 * Message log — every email / WhatsApp / SMS the system sent a guest: to whom,
 * what, when, and how it landed. Filter by channel and status, search by guest /
 * type / hotel, tap a row to open the full message, "Load older" for history.
 * Sandbox sends are counted and labelled separately so nothing reads as delivered
 * when the channel isn't live yet.
 */
import { useMemo, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { loadOlderMessages } from "../message-detail";
import { MessageDetailDialog } from "./message-detail-dialog";
import { CHANNEL_LABEL, messageTitle, statusLabel } from "./message-labels";

export type LogRow = {
  id: string;
  channel: string;
  category: string | null;
  templateKey: string | null;
  toAddress: string;
  status: string;
  error: string | null;
  createdAt: Date;
  guestName: string | null;
  sandbox: boolean;
  propertyName?: string;
};

const fmtTime = (d: Date) => new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

const tone = (r: LogRow) =>
  r.status === "FAILED" ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
  : r.sandbox ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
  : r.status === "QUEUED" ? "bg-muted text-muted-foreground"
  : r.status === "SENT" ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
  : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";

type StatusKey = "" | "real" | "sandbox" | "QUEUED" | "FAILED";
const isReal = (r: LogRow) => !r.sandbox && (r.status === "SENT" || r.status === "DELIVERED" || r.status === "READ");

export function MessageLog({ initial, propertyId, showProperty }: { initial: LogRow[]; propertyId: string | null; showProperty: boolean }) {
  const [rows, setRows] = useState(initial);
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState<StatusKey>("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [more, setMore] = useState(initial.length >= 50);
  const [pending, start] = useTransition();

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter((r) =>
      (!channel || r.channel === channel)
      && (status === "" || (status === "real" ? isReal(r) : status === "sandbox" ? r.sandbox : r.status === status))
      && (!n || `${r.guestName ?? ""} ${r.toAddress} ${messageTitle(r.templateKey, r.category)} ${r.propertyName ?? ""}`.toLowerCase().includes(n)));
  }, [rows, channel, status, q]);

  const loadOlder = () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    start(async () => {
      const r = await loadOlderMessages({ before: new Date(last.createdAt).toISOString(), propertyId });
      if (!r.ok) return;
      setRows((prev) => [...prev, ...r.data]);
      setMore(r.data.length >= 100);
    });
  };

  const counts: [StatusKey, string, number][] = [
    ["", "All", rows.length],
    ["real", "Sent / delivered", rows.filter(isReal).length],
    ["sandbox", "Not sent (test mode)", rows.filter((r) => r.sandbox).length],
    ["QUEUED", "Waiting", rows.filter((r) => r.status === "QUEUED").length],
    ["FAILED", "Failed", rows.filter((r) => r.status === "FAILED").length],
  ];

  return (
    <div className="space-y-3" data-testid="message-log">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {counts.map(([key, label, value]) => (
          <button
            key={key || "all"}
            type="button"
            onClick={() => setStatus(key)}
            aria-pressed={status === key}
            className={`min-h-11 rounded-lg border p-2.5 text-center ${status === key ? "border-primary bg-primary/5" : "bg-card"}`}
          >
            <div className="text-lg font-semibold tabular-nums">{value}</div>
            <div className="text-[11px] text-muted-foreground">{label}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {["", "EMAIL", "WHATSAPP", "SMS"].map((c) => (
            <button
              key={c || "all"}
              type="button"
              onClick={() => setChannel(c)}
              aria-pressed={channel === c}
              className={`min-h-9 shrink-0 rounded-md px-3 text-xs ${channel === c ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
            >
              {c ? CHANNEL_LABEL[c] : "All channels"}
            </button>
          ))}
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search guest, message type, hotel…" aria-label="Search messages" className="h-9 max-w-xs" data-testid="message-search" />
      </div>

      <ul className="divide-y rounded-md border">
        {shown.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => setOpen(r.id)} className="flex min-h-14 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/50" data-testid={`message-row-${r.id}`}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {r.guestName ?? "—"}
                  <span className="font-normal text-muted-foreground"> · {CHANNEL_LABEL[r.channel] ?? r.channel} · {messageTitle(r.templateKey, r.category)}</span>
                  {showProperty && r.propertyName ? <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">{r.propertyName}</span> : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">{r.toAddress} · {fmtTime(r.createdAt)}{r.error ? ` · ${r.error}` : ""}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${tone(r)}`}>{statusLabel(r.status, r.sandbox)}</span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="py-8 text-center text-sm text-muted-foreground">No messages match.</li>}
      </ul>

      {more && <Button variant="outline" onClick={loadOlder} disabled={pending}>{pending ? "Loading…" : "Load older messages"}</Button>}

      <MessageDetailDialog messageId={open} onClose={() => setOpen(null)} />
    </div>
  );
}
