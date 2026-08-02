import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { kitchenPrep } from "@/features/pos/queries";
import { KitchenScreen } from "@/features/pos/components/kitchen-screen";

export const metadata: Metadata = { title: "Kitchen" };

/** 19 T-18 — the aggregated kitchen prep list across all open orders (FR-13, AC-12). */
export default async function KitchenPage() {
  const user = await requirePermission("pos:order-create");
  const propertyId = user.activePropertyId;
  if (!propertyId) {
    return <div className="p-4"><p className="text-sm text-muted-foreground">Select a property.</p></div>;
  }
  const prep = await kitchenPrep(user, propertyId);
  return <KitchenScreen prep={prep} />;
}
