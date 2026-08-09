import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { listLaundryBatches } from "@/features/inventory/queries";
import { LaundryScreen } from "@/features/inventory/components/laundry-screen";

export const metadata: Metadata = { title: "Laundry" };

/** 20 addendum — laundry linen reconciliation (sent vs returned). inventory:manage. */
export default async function LaundryPage() {
  const user = await requirePermission("inventory:manage");
  const propertyId = user.activePropertyId;
  if (!propertyId) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">Select a property to manage laundry.</p>
      </div>
    );
  }
  const batches = await listLaundryBatches(user, { propertyId });
  return <LaundryScreen propertyId={propertyId} batches={batches} />;
}
