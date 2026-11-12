"use client";

/**
 * Guaranteed late arrival (client, 12 Nov 2026) — for the guest who misses the
 * check-in day but calls to say "don't cancel, I'll come and pay from the booked
 * date". Holding the booking keeps its room, keeps it in today's arrivals until
 * the guest comes, stops the night audit marking it no-show, and the check-in
 * bills every night from the booked check-in date.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setArrivalGuarantee } from "../late-arrival-actions";

const fmt = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

export function LateArrivalCard({
  reservationId,
  status,
  guaranteed,
  checkInDate,
  hasRoom,
}: {
  reservationId: string;
  status: string;
  guaranteed: boolean;
  checkInDate: string;
  hasRoom: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = (on: boolean) => {
    setError(null);
    start(async () => {
      const res = await setArrivalGuarantee({ reservationId, guaranteed: on });
      if (res.ok) router.refresh();
      else setError(res.error.message);
    });
  };

  return (
    <Card className={guaranteed ? "border-primary/50" : undefined} data-testid="late-arrival">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary">
          <CalendarClock /> Late arrival
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {guaranteed ? (
          <>
            <p data-testid="late-arrival-on">
              <b>Room held — guest will arrive late.</b> This booking stays in today&apos;s arrivals and is never marked no-show. At check-in the bill starts from <b>{fmt(checkInDate)}</b>.
            </p>
            {!hasRoom && (
              <p className="rounded-md border border-warning/50 bg-warning/10 p-2 text-xs">No room is assigned (the no-show released it). Assign one with <b>Move / assign room</b> below.</p>
            )}
            <Button size="sm" variant="outline" disabled={pending} onClick={() => set(false)} data-testid="late-arrival-off">
              {pending ? "Saving…" : "Guest isn't coming — remove the hold"}
            </Button>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">
              Guest missed the check-in day but called to say they&apos;re still coming and will pay from {fmt(checkInDate)}? Hold the booking — the room stays theirs, it isn&apos;t marked no-show, and the bill starts from {fmt(checkInDate)} when they check in.
            </p>
            <Button size="sm" disabled={pending} onClick={() => set(true)} data-testid="late-arrival-hold">
              {pending ? "Saving…" : status === "NO_SHOW" ? "Guest still coming — restore & hold the booking" : "Hold for late arrival (bill from booked date)"}
            </Button>
          </>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
