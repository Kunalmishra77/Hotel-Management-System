import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { getReservation } from "@/features/reservations/queries";
import { getFolio } from "@/features/billing/queries";
import { listActiveAddOns } from "@/features/add-ons/queries";
import { FolioScreen } from "@/features/billing/components/folio-screen";
import { CreateBillButton } from "@/features/billing/components/create-bill-button";
import { hasPermission } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Folio" };

/** 06 T-26 — the folio for a reservation (AC-2). */
export default async function FolioPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("folio:view");
  const { id } = await params;
  const reservation = await getReservation(user, id);
  if (!reservation) notFound();

  const folioRow = await db.scoped(user).folio.findFirst({ where: { reservationId: id }, select: { id: true, propertyId: true } });
  if (!folioRow) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
        <h1 className="text-xl font-semibold">Folio</h1>
        <p className="text-sm text-muted-foreground">
          No bill yet for this stay. If it was saved as history only (no rate) but you need to add charges
          the guest already paid for — e.g. food — create the bill, then add the charges.
        </p>
        {hasPermission(user, "folio:charge") ? <CreateBillButton reservationId={id} /> : null}
        <Button asChild variant="outline"><Link href={`/bookings/${id}`}>Back to booking</Link></Button>
      </div>
    );
  }

  const folio = await getFolio(user, folioRow.id);
  if (!folio) notFound();
  const addOns = await listActiveAddOns(folioRow.propertyId);
  return (
    <FolioScreen
      folio={folio}
      guestName={reservation.guestName}
      reservationId={id}
      addOns={addOns.map((a) => ({ id: a.id, name: a.name, pricePaise: a.pricePaise }))}
    />
  );
}
