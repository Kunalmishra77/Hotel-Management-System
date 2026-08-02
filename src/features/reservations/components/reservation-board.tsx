"use client";

/**
 * Reservation board — 03 T-29/T-30/T-31 (AC-15/16/17). Cards on a phone; each
 * carries the guest, room, dates, balance and the one action its status allows
 * (Check-in for CONFIRMED, Check-out for IN_HOUSE). Actions are optimistic-ish:
 * they call the server action and refresh on success, surfacing the balance gate
 * message (AC-16) inline when check-out is blocked.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { checkIn, checkOut } from "../lifecycle-actions";
import type { ReservationListItem } from "../queries";

export function ReservationBoard({
  arrivals,
  inHouse,
  departures,
}: {
  arrivals: ReservationListItem[];
  inHouse: ReservationListItem[];
  departures: ReservationListItem[];
}) {
  return (
    <div className="space-y-6">
      <Section title={`Arrivals today (${arrivals.length})`} items={arrivals} testid="arrivals" />
      <Section title={`In-house (${inHouse.length})`} items={inHouse} testid="in-house" />
      <Section title={`Departures today (${departures.length})`} items={departures} testid="departures" />
    </div>
  );
}

function Section({ title, items, testid }: { title: string; items: ReservationListItem[]; testid: string }) {
  return (
    <section data-testid={`section-${testid}`}>
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((r) => <li key={r.id}><ReservationCard r={r} /></li>)}
        </ul>
      )}
    </section>
  );
}

function ReservationCard({ r }: { r: ReservationListItem }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const act = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.error?.message ?? "Something went wrong.");
    });
  };

  return (
    <Card data-testid={`reservation-${r.code}`}>
      <CardContent className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium">
            {r.guestName}
            {r.roomNumbers.length > 0 && <span className="text-muted-foreground"> · {r.roomNumbers.join(", ")}</span>}
          </p>
          <p className="text-sm text-muted-foreground">
            {r.code} · {r.status}
            {r.needsAttention && <span className="text-destructive"> · {r.needsAttention}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm"><Link href={`/bookings/${r.id}`}>Open</Link></Button>
          {r.status === "CONFIRMED" && (
            <Button size="sm" disabled={pending} onClick={() => act(() => checkIn({ reservationId: r.id }))}
              data-testid={`checkin-${r.code}`}>Check in</Button>
          )}
          {r.status === "IN_HOUSE" && (
            <Button size="sm" disabled={pending} onClick={() => act(() => checkOut({ reservationId: r.id }))}
              data-testid={`checkout-${r.code}`}>Check out</Button>
          )}
        </div>
        {error && <p role="alert" className="w-full text-sm text-destructive" data-testid={`error-${r.code}`}>{error}</p>}
      </CardContent>
    </Card>
  );
}
