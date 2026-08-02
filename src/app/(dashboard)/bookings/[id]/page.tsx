import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/guard";
import { getReservation } from "@/features/reservations/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Booking" };

/** 03 T-29 — a single reservation. */
export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("reservation:view");
  const { id } = await params;
  const r = await getReservation(user, id);
  if (!r) notFound();

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold" data-testid="booking-code">{r.code}</h1>
        <div className="flex gap-2">
          <Button asChild size="sm"><Link href={`/bookings/${r.id}/folio`} data-testid="open-folio">Folio</Link></Button>
          <Button asChild variant="outline" size="sm"><Link href="/bookings">Back</Link></Button>
        </div>
      </div>
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">{r.guestName}</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>Status: <span data-testid="booking-status">{r.status}</span></p>
          <p>Rooms: {r.roomNumbers.join(", ") || "— (unallocated)"}</p>
          <p>{fmt(r.checkInDate)} → {fmt(r.checkOutDate)} · {r.nights} night(s)</p>
          {r.needsAttention && <p className="text-destructive">Needs attention: {r.needsAttention}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
