import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { BookingForm } from "@/features/reservations/components/booking-form";

export const metadata: Metadata = { title: "New booking" };

/** 03 T-28 — the booking stepper (AC-1/2/4). */
export default async function NewBookingPage() {
  const user = await requirePermission("reservation:create");
  const propertyId = user.activePropertyId;
  if (!propertyId) notFound();

  const [property, categories] = await Promise.all([
    db.scoped(user).property.findFirst({ where: { id: propertyId }, select: { timezone: true } }),
    db.scoped(user).roomCategory.findMany({ where: { propertyId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (!property) notFound();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">New booking</h1>
      <BookingForm propertyId={propertyId} categories={categories} timezone={property.timezone} />
    </div>
  );
}
