import type { Metadata } from "next";
import Link from "next/link";
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
    // Only categories that still have a sellable (active) room — hides stale/demo
    // categories (e.g. D-1/17's old Deluxe/Suite, whose rooms are all inactive) so
    // the booking dropdown shows just the real ones (#2).
    db.unscoped().roomCategory.findMany({ where: { propertyId: { in: ids }, rooms: { some: { isActive: true } } }, select: { id: true, name: true, propertyId: true }, orderBy: { name: "asc" } }),
  ]);
  if (properties.length === 0) notFound();
  const defaultPropertyId = properties.some((p) => p.id === user.activePropertyId) ? user.activePropertyId! : properties[0]!.id;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">New booking</h1>
        <Link href="/bookings/new/off-site" className="text-sm text-primary underline underline-offset-4">
          Booking at another (off-site) property?
        </Link>
      </div>
      <BookingForm properties={properties} categories={categories} defaultPropertyId={defaultPropertyId} />
    </div>
  );
}
