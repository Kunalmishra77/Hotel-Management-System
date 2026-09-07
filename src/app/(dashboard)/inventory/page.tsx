import type { Metadata } from "next";
import { hasPermission } from "@/lib/permissions";
import { NoProperty } from "@/features/platform/components/no-property";
import { requirePermission } from "@/lib/auth/guard";
import { stockLevels, inventoryOverview } from "@/features/inventory/queries";
import { InventoryScreen } from "@/features/inventory/components/inventory-screen";

export const metadata: Metadata = { title: "Inventory" };

/** 20 T-11 — store stock list + quick stock-in + low-stock badges (AC-1/2/5). */
export default async function InventoryPage() {
  const user = await requirePermission("inventory:manage");
  const propertyId = user.activePropertyId;
  if (!propertyId) {
    return <NoProperty what="This page" canCreate={hasPermission(user, "property:manage")} />;
  }
  const [items, overview] = await Promise.all([
    stockLevels(user, { propertyId }),
    inventoryOverview(user, propertyId),
  ]);
  return <InventoryScreen propertyId={propertyId} items={items} overview={overview} />;
}
