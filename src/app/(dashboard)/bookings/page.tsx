import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/guard";
import { arrivalsDepartures, listReservations } from "@/features/reservations/queries";
import { ReservationBoard } from "@/features/reservations/components/reservation-board";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Bookings" };

/** 03 T-29 — the reservation board for the active property (FR-9/10). */
export default async function BookingsPage() {
  const user = await requirePermission("reservation:view");
  const propertyId = user.activePropertyId;

  if (!propertyId) {
    return <div className="p-4"><p className="text-sm text-muted-foreground">Select a property to see its bookings.</p></div>;
  }

  const [{ arrivals, departures }, inHouse] = await Promise.all([
    arrivalsDepartures(user, { propertyId, date: new Date() }),
    listReservations(user, { propertyId, status: "IN_HOUSE", limit: 50 }),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Bookings</h1>
        <Button asChild size="sm"><Link href="/bookings/new" data-testid="new-booking-link">New booking</Link></Button>
      </div>
      <ReservationBoard arrivals={arrivals} inHouse={inHouse.reservations} departures={departures} />
    </div>
  );
}
