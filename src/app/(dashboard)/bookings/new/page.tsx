import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { BookingForm } from "@/features/reservations/components/booking-form";

export const metadata: Metadata = { title: "New booking" };

/** 03 T-28 — the booking stepper (AC-1/2/4). Property-first: the user picks the
 *  property, then that property's room categories. */
export default async function NewBookingPage() {
  const user = await requirePermission("reservation:create");
  const ids = [...user.accessiblePropertyIds];
  if (ids.length === 0) notFound();

  const [properties, categories] = await Promise.all([
    db.unscoped().property.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, name: true, timezone: true }, orderBy: { name: "asc" } }),
    db.unscoped().roomCategory.findMany({ where: { propertyId: { in: ids } }, select: { id: true, name: true, propertyId: true }, orderBy: { name: "asc" } }),
  ]);
  if (properties.length === 0) notFound();
  const defaultPropertyId = properties.some((p) => p.id === user.activePropertyId) ? user.activePropertyId! : properties[0]!.id;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">New booking</h1>
      <BookingForm properties={properties} categories={categories} defaultPropertyId={defaultPropertyId} />
    </div>
  );
}
