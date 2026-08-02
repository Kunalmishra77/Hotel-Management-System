import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { stockLevels } from "@/features/inventory/queries";
import { InventoryScreen } from "@/features/inventory/components/inventory-screen";

export const metadata: Metadata = { title: "Inventory" };

/** 20 T-11 — store stock list + quick stock-in + low-stock badges (AC-1/2/5). */
export default async function InventoryPage() {
  const user = await requirePermission("inventory:manage");
  const propertyId = user.activePropertyId;
  if (!propertyId) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">Select a property to manage stock.</p>
      </div>
    );
  }
  const items = await stockLevels(user, { propertyId });
  return <InventoryScreen propertyId={propertyId} items={items} />;
}
