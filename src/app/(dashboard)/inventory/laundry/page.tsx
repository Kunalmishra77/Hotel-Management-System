import type { Metadata } from "next";
import { hasPermission } from "@/lib/permissions";
import { NoProperty } from "@/features/platform/components/no-property";
import { requirePermission } from "@/lib/auth/guard";
import { listLaundryBatches } from "@/features/inventory/queries";
import { LaundryScreen } from "@/features/inventory/components/laundry-screen";

export const metadata: Metadata = { title: "Laundry" };

/** 20 addendum — laundry linen reconciliation (sent vs returned). inventory:manage. */
export default async function LaundryPage() {
  const user = await requirePermission("inventory:manage");
  const propertyId = user.activePropertyId;
  if (!propertyId) {
    return <NoProperty what="This page" canCreate={hasPermission(user, "property:manage")} />;
  }
  const batches = await listLaundryBatches(user, { propertyId });
  return <LaundryScreen propertyId={propertyId} batches={batches} />;
}
