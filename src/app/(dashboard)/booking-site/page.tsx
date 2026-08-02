/**
 * Staff booking-site configuration page — 23 T-17b (FR-17, AC-19). Server-gated
 * on `bookingengine:manage`; hiding the nav item is cosmetic (security.md).
 */
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guard";
import { ConfigForm } from "@/features/booking-engine/components/config-form";

export const metadata: Metadata = { title: "Booking site" };

export default async function BookingSitePage() {
  const user = await requirePermission("bookingengine:manage");
  const propertyId = user.activePropertyId;
  if (!propertyId) {
    return <div className="p-4"><p className="text-sm text-muted-foreground">Select a property to configure its booking site.</p></div>;
  }

  const [config, categories] = await Promise.all([
    db.unscoped().bookingEngineConfig.findUnique({ where: { propertyId } }),
    db.scoped(user).roomCategory.findMany({ where: { propertyId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Booking site</h1>
      <ConfigForm
        propertyId={propertyId}
        config={
          config
            ? {
                slug: config.slug,
                onlineSellableCategoryIds: config.onlineSellableCategoryIds,
                depositPolicy: config.depositPolicy,
                depositValue: config.depositValue,
                checkoutTtlMin: config.checkoutTtlMin,
                minLos: config.minLos,
                leadTimeDays: config.leadTimeDays,
                maxRoomsPerBooking: config.maxRoomsPerBooking,
                cancelWindowHours: config.cancelWindowHours,
                isPublished: config.isPublished,
              }
            : null
        }
        categories={categories}
      />
    </div>
  );
}
