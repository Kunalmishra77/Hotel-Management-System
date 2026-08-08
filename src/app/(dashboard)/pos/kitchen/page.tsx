import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { kitchenPrep, kitchenTickets } from "@/features/pos/queries";
import { KitchenScreen } from "@/features/pos/components/kitchen-screen";

export const metadata: Metadata = { title: "Kitchen" };

/** 19 T-18/T-24 — aggregated prep list + the live per-ticket lifecycle board. */
export default async function KitchenPage() {
  const user = await requirePermission("pos:order-create");
  const propertyId = user.activePropertyId;
  if (!propertyId) {
    return <div className="p-4"><p className="text-sm text-muted-foreground">Select a property.</p></div>;
  }
  const [prep, tickets] = await Promise.all([kitchenPrep(user, propertyId), kitchenTickets(user, propertyId)]);
  return <KitchenScreen prep={prep} tickets={tickets} />;
}
