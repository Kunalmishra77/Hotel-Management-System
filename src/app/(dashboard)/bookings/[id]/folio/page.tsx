import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { getReservation } from "@/features/reservations/queries";
import { getFolio } from "@/features/billing/queries";
import { FolioScreen } from "@/features/billing/components/folio-screen";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Folio" };

/** 06 T-26 — the folio for a reservation (AC-2). */
export default async function FolioPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("folio:view");
  const { id } = await params;
  const reservation = await getReservation(user, id);
  if (!reservation) notFound();

  const folioRow = await db.scoped(user).folio.findFirst({ where: { reservationId: id }, select: { id: true } });
  if (!folioRow) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
        <h1 className="text-xl font-semibold">Folio</h1>
        <p className="text-sm text-muted-foreground">No folio yet — it is created when the booking is confirmed or checked in.</p>
        <Button asChild variant="outline"><Link href={`/bookings/${id}`}>Back to booking</Link></Button>
      </div>
    );
  }

  const folio = await getFolio(user, folioRow.id);
  if (!folio) notFound();
  return <FolioScreen folio={folio} guestName={reservation.guestName} />;
}
