import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { OffSiteBookingForm } from "@/features/reservations/components/off-site-booking-form";

export const metadata: Metadata = { title: "Off-site booking" };

/** #1 — record a booking at an "Other" (off-site) property we don't operate. */
export default async function OffSiteBookingPage() {
  const user = await requirePermission("reservation:create");
  const ids = [...user.accessiblePropertyIds];
  if (ids.length === 0) notFound();
  const properties = await db.unscoped().property.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (properties.length === 0) notFound();
  const defaultPropertyId = properties.some((p) => p.id === user.activePropertyId) ? user.activePropertyId! : properties[0]!.id;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Off-site (other) property booking</h1>
      <OffSiteBookingForm properties={properties} defaultPropertyId={defaultPropertyId} />
    </div>
  );
}
