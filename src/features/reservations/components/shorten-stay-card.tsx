"use client";

/**
 * Move an in-house guest's check-out EARLIER (client, 15 Nov 2026) — e.g. a
 * month's booking where the guest says after check-in they leave in 5 days.
 * Saving frees the room for the nights after the new date straight away (it
 * shows as available) and reverses those nights on the bill. The guest stays
 * checked in; press Check out on the day they actually leave.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { shortenStay } from "../shorten-actions";

const fmt = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

export function ShortenStayCard({
  reservationId,
  checkInDate,
  checkOutDate,
}: {
  reservationId: string;
  checkInDate: string;
  checkOutDate: string;
}) {
  const router = useRouter();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const firstNight = new Date(Date.parse(`${checkInDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const min = today > firstNight ? today : firstNight;
  const lastOk = new Date(Date.parse(`${checkOutDate}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const [date, setDate] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  // Nothing to shorten: already leaving today/tomorrow at the earliest.
  if (min > lastOk) return null;

  const blocker = !date
    ? "Pick the new check-out date."
    : date >= checkOutDate
      ? `Pick a date before ${fmt(checkOutDate)}. To make the stay longer use Extend stay.`
      : date < min
        ? `The earliest is ${fmt(min)}. If the guest is leaving now, press Check out.`
        : null;
  const freed = date && !blocker ? Math.round((Date.parse(`${checkOutDate}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000) : 0;

  function save() {
    setMsg(null);
    start(async () => {
      const res = await shortenStay({ reservationId, newCheckOutDate: date });
      if (!res.ok) {
        setMsg({ ok: false, text: res.error.message || "Couldn't change the check-out." });
        return;
      }
      setMsg({ ok: true, text: `Check-out moved to ${fmt(res.data.checkOutDate)}. ${res.data.reversedNights} night(s) taken off the bill; the room is free from that date.` });
      setDate("");
      router.refresh();
    });
  }

  return (
    <Card data-testid="shorten-stay">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarMinus className="size-4" aria-hidden="true" /> Leaving earlier
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Guest will leave before {fmt(checkOutDate)}? Set the new check-out now — the room becomes available from that date and the unused nights come off the bill. The guest stays checked in.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="shorten-date">New check-out</Label>
            <Input id="shorten-date" type="date" min={min} max={lastOk} value={date} onChange={(e) => setDate(e.target.value)} className="w-44" data-testid="shorten-date" />
          </div>
          <Button type="button" disabled={pending || !!blocker} onClick={save} data-testid="shorten-save">
            {pending ? "Saving…" : freed ? `Move check-out (${freed} night${freed === 1 ? "" : "s"} freed)` : "Move check-out"}
          </Button>
        </div>
        {blocker && date ? <p className="text-xs text-muted-foreground">{blocker}</p> : null}
        {msg ? <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-destructive"}>{msg.text}</p> : null}
      </CardContent>
    </Card>
  );
}
