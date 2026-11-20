"use client";

/**
 * Rooms → "Find a room" (client, 20 Nov 2026): a guest calls — "do you have a
 * room from 25 Nov to 25 Dec?". Enter the dates and see, per hotel: rooms free
 * for the whole stay (with an estimated bill and a Book button that opens New
 * booking pre-filled), a split-stay plan when no single room is free
 * throughout, and rooms free for part of the stay with what blocks the rest.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { CalendarSearch, Check, Shuffle, CircleDashed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatINR } from "@/lib/utils";
import { findRoomsForDatesAction } from "../availability-action";
import type { RoomFinderResult } from "../room-finder";

const fmt = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const range = (r: { from: string; to: string }) => `${fmt(r.from)} → ${fmt(r.to)}`;
const nightsBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function RoomFinder({ canBook }: { canBook: boolean }) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 1));
  const [result, setResult] = useState<RoomFinderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPartial, setShowPartial] = useState(false);
  const [pending, start] = useTransition();

  const search = () => {
    setError(null);
    start(async () => {
      const res = await findRoomsForDatesAction({ from, to });
      if (res.ok) { setResult(res.data); setShowPartial(false); } else { setResult(null); setError(res.error.message); }
    });
  };
  const bookHref = (propertyId: string, roomId?: string) =>
    `/bookings/new?property=${propertyId}&in=${result?.from ?? from}&out=${result?.to ?? to}${roomId ? `&room=${roomId}` : ""}`;
  const wholeCount = result?.hotels.reduce((n, h) => n + h.whole.length, 0) ?? 0;

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4" data-testid="room-finder">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold"><CalendarSearch className="size-4 text-primary" aria-hidden="true" /> Find a room</h2>
        <p className="text-sm text-muted-foreground">A guest asks for dates? Check which rooms are free, the estimated bill, and book in one tap.</p>
      </div>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <div className="space-y-1.5">
          <Label htmlFor="rf-in">Check-in</Label>
          <Input id="rf-in" type="date" value={from} min={today} onChange={(e) => { setFrom(e.target.value); if (to <= e.target.value) setTo(addDays(e.target.value, 1)); }} className="w-44" data-testid="rf-in" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rf-out">Check-out</Label>
          <Input id="rf-out" type="date" value={to} min={addDays(from, 1)} onChange={(e) => setTo(e.target.value)} className="w-44" data-testid="rf-out" />
        </div>
        <Button type="submit" disabled={pending || !from || !to || to <= from} data-testid="rf-search">
          {pending ? "Checking…" : `Find rooms${to > from ? ` · ${nightsBetween(from, to)} night${nightsBetween(from, to) === 1 ? "" : "s"}` : ""}`}
        </Button>
      </form>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      {result ? (
        <div className="space-y-4" data-testid="rf-result">
          <p className="text-sm">
            <strong>{range(result)}</strong> · {result.nights} night{result.nights === 1 ? "" : "s"} —{" "}
            {wholeCount > 0 ? <span className="text-success">{wholeCount} room{wholeCount === 1 ? "" : "s"} free for the whole stay</span> : <span className="text-destructive">no single room is free for the whole stay</span>}
            {result.capped ? <span className="text-muted-foreground"> (showing the first {result.nights} nights — check the rest separately)</span> : null}
          </p>

          {result.hotels.map((h) => (
            <div key={h.propertyId} className="space-y-2 rounded-lg border p-3">
              <h3 className="text-sm font-semibold">{h.propertyName}</h3>

              {h.whole.length > 0 ? (
                <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {h.whole.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-success/40 bg-success/5 px-3 py-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 font-medium"><Check className="size-3.5 text-success" aria-hidden="true" /> {r.number}<span className="truncate text-xs font-normal text-muted-foreground">· {r.categoryName}{r.floorName ? ` · ${r.floorName}` : ""}</span></p>
                        <p className="text-xs text-muted-foreground">{formatINR(r.ratePaise)}/night + GST · est. <span className="font-medium text-foreground">{formatINR(r.estimatePaise)}</span></p>
                      </div>
                      {canBook ? <Button asChild size="sm"><Link href={bookHref(h.propertyId, r.id)} data-testid={`rf-book-${r.number}`}>Book</Link></Button> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No room here is free for every night.</p>
              )}

              {h.split ? (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5 text-sm" data-testid="rf-split">
                  <p className="flex items-center gap-1.5 font-medium"><Shuffle className="size-3.5 text-primary" aria-hidden="true" /> Possible with a room change ({h.split.segments.length} rooms)</p>
                  <ul className="mt-1 space-y-0.5">
                    {h.split.segments.map((s) => <li key={s.from}>Room <strong>{s.number}</strong>: {range(s)} ({nightsBetween(s.from, s.to)} night{nightsBetween(s.from, s.to) === 1 ? "" : "s"})</li>)}
                  </ul>
                  <p className="mt-1 text-xs text-muted-foreground">Est. {formatINR(h.split.estimatePaise)} at room-type rates. Book it as a split stay — New booking opens with these dates; pick the rooms night by night.</p>
                  {canBook ? <Button asChild size="sm" variant="outline" className="mt-2"><Link href={bookHref(h.propertyId)}>Book as split stay</Link></Button> : null}
                </div>
              ) : null}

              {h.partial.length > 0 && showPartial ? (
                <ul className="space-y-1.5" data-testid="rf-partial">
                  {h.partial.map((r) => (
                    <li key={r.id} className="rounded-md border px-3 py-2 text-sm">
                      <p className="flex items-center gap-1.5 font-medium"><CircleDashed className="size-3.5 text-warning" aria-hidden="true" /> {r.number} <span className="text-xs font-normal text-muted-foreground">· {r.categoryName} · free {r.freeNights} of {result.nights} nights</span></p>
                      <p className="text-xs">Free: {r.free.map(range).join(", ")}</p>
                      <p className="text-xs text-muted-foreground">
                        Taken: {r.busy.map((b, i) => (
                          <span key={i}>{i ? ", " : ""}{range(b)} ({b.reservationId ? <Link href={`/bookings/${b.reservationId}`} className="underline underline-offset-2">{b.label}</Link> : b.label})</span>
                        ))}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
              {h.partial.length > 0 && !showPartial ? (
                <button type="button" className="text-xs text-primary underline underline-offset-4" onClick={() => setShowPartial(true)}>
                  Show {h.partial.length} room{h.partial.length === 1 ? "" : "s"} free for part of the stay
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
