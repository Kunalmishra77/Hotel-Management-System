"use client";

/**
 * "Swap room with another booking" — for a guest who hasn't checked in yet and
 * wants the room(s) another guest is booked into (that guest must not be
 * in-house), in this property or another. Like for like: single ↔ single,
 * 2 BHK ↔ 2 BHK. Staff pick the other booking and SEE exactly whose room they are
 * taking (name, code, mobile, rooms, dates) before confirming. Each guest keeps
 * their own dates and rate.
 */
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BOOKING_SOURCE_LABEL } from "@/lib/constants/company";
import { swapCandidates, swapRooms, type SwapCandidate } from "../swap-actions";

const dm = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const unit = (n: number) => (n === 1 ? "single room" : `${n} rooms`);

export function SwapRoomCard({
  reservationId,
  guestName,
  rooms,
  roomCount,
  propertyName,
  checkIn,
  checkOut,
}: {
  reservationId: string;
  guestName: string;
  rooms: string;
  roomCount: number;
  propertyName: string;
  checkIn: string;
  checkOut: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<SwapCandidate[] | null>(null);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<SwapCandidate | null>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!open || list) return;
    swapCandidates(reservationId).then((r) => (r.ok ? setList(r.data) : setError(r.error.message)));
  }, [open, list, reservationId]);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    const all = list ?? [];
    return (n ? all.filter((c) => `${c.guestName} ${c.code} ${c.rooms} ${c.propertyName} ${c.maskedMobile ?? ""}`.toLowerCase().includes(n)) : all).slice(0, 40);
  }, [list, q]);

  const confirm = () => {
    if (!pick) return;
    setError(null);
    start(async () => {
      const res = await swapRooms({ reservationId, otherReservationId: pick.id, reason: reason.trim() || undefined });
      if (!res.ok) { setError(res.error.message); return; }
      setDone(`${guestName} → ${res.data.a.room} (${res.data.a.property}) · ${pick.guestName} → ${res.data.b.room} (${res.data.b.property})`);
      setPick(null);
      setList(null);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary"><ArrowLeftRight /> Swap room with another booking</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Guest wants the room another guest is booked into (that guest hasn&apos;t checked in)? Swap them — any property, like for like ({unit(roomCount)} ↔ {unit(roomCount)}). Each guest keeps their own dates and rate.
        </p>
        {done && <p className="rounded-md border border-emerald-600/30 bg-emerald-500/10 p-2 text-sm text-emerald-700 dark:text-emerald-400" data-testid="swap-done">✔ Swapped: {done}</p>}
        {!open ? (
          <Button variant="outline" onClick={() => { setOpen(true); setDone(null); }} data-testid="swap-open">Choose the other booking</Button>
        ) : (
          <div className="space-y-3">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search guest, mobile, booking code, room or property…" aria-label="Search bookings" data-testid="swap-search" />
            {list === null && !error ? <p className="text-sm text-muted-foreground">Loading bookings…</p> : null}
            {list && shown.length === 0 ? <p className="text-sm text-muted-foreground">No upcoming {unit(roomCount)} booking (not checked in) to swap with.</p> : null}
            <ul className="max-h-72 divide-y overflow-y-auto rounded-md border text-sm" data-testid="swap-list">
              {shown.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setPick(c)}
                    aria-pressed={pick?.id === c.id}
                    className={`flex min-h-11 w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-muted/50 ${pick?.id === c.id ? "bg-primary/10" : ""}`}
                    data-testid={`swap-pick-${c.code}`}
                  >
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <span><span className="font-medium">{c.guestName}</span><span className="text-muted-foreground"> · {c.code}{c.maskedMobile ? ` · ${c.maskedMobile}` : ""}</span></span>
                      <span className="font-medium">{c.rooms}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {c.propertyName} · {dm(c.checkIn)} → {dm(c.checkOut)} ({c.nights} night{c.nights === 1 ? "" : "s"}) · {c.adults} adult{c.adults === 1 ? "" : "s"} · {BOOKING_SOURCE_LABEL[c.source] ?? c.source}{c.status === "ENQUIRY" ? " · hold" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {pick && (
              <div className="space-y-3 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm" data-testid="swap-preview">
                <p className="font-medium">Customer B — whose room you are taking</p>
                <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">Guest</dt><dd className="font-medium">{pick.guestName}</dd>
                  <dt className="text-muted-foreground">Booking</dt><dd>{pick.code} · {BOOKING_SOURCE_LABEL[pick.source] ?? pick.source}</dd>
                  <dt className="text-muted-foreground">Mobile</dt><dd>{pick.maskedMobile ?? "—"}</dd>
                  <dt className="text-muted-foreground">Stay</dt><dd>{dm(pick.checkIn)} → {dm(pick.checkOut)} · {pick.nights} night{pick.nights === 1 ? "" : "s"} · {pick.adults} adult{pick.adults === 1 ? "" : "s"}</dd>
                </dl>
                <div className="space-y-1 border-t pt-2">
                  <p><span className="font-medium">{guestName}</span> ({dm(checkIn)} → {dm(checkOut)}): {rooms} · {propertyName} → <span className="font-semibold">{pick.rooms} · {pick.propertyName}</span></p>
                  <p><span className="font-medium">{pick.guestName}</span> ({dm(pick.checkIn)} → {dm(pick.checkOut)}): {pick.rooms} · {pick.propertyName} → <span className="font-semibold">{rooms} · {propertyName}</span></p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="swap-reason">Note (optional)</Label>
                  <Input id="swap-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. guest asked for an upper floor" />
                </div>
                <div className="flex gap-2">
                  <Button onClick={confirm} disabled={pending} data-testid="swap-confirm">{pending ? "Swapping…" : "Swap rooms"}</Button>
                  <Button variant="ghost" onClick={() => setPick(null)}>Back</Button>
                </div>
              </div>
            )}
            {!pick && <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>}
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
