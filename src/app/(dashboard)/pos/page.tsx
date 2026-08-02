import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { listOutlets, listMenu, listOpenOrders, getOrder } from "@/features/pos/queries";
import { PosScreen } from "@/features/pos/components/pos-screen";

export const metadata: Metadata = { title: "POS" };

/** 19 T-17/T-18 — restaurant order capture, live bill, settle (AC-1/2/5/7/12). */
export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<{ outletId?: string; orderId?: string; reservationId?: string }>;
}) {
  const user = await requirePermission("pos:order-create");
  const propertyId = user.activePropertyId;
  if (!propertyId) {
    return <div className="p-4"><p className="text-sm text-muted-foreground">Select a property to use the POS.</p></div>;
  }

  const sp = await searchParams;
  const outlets = await listOutlets(user, propertyId);
  if (outlets.length === 0) {
    return <div className="p-4"><p className="text-sm text-muted-foreground">No POS outlets configured for this property.</p></div>;
  }

  const outletId = sp.outletId && outlets.some((o) => o.id === sp.outletId) ? sp.outletId : outlets[0]!.id;
  const [menu, openOrders, activeOrder] = await Promise.all([
    listMenu(user, outletId),
    listOpenOrders(user, { propertyId, outletId }),
    sp.orderId ? getOrder(user, sp.orderId) : Promise.resolve(null),
  ]);

  return (
    <PosScreen
      outlets={outlets}
      outletId={outletId}
      menu={menu}
      openOrders={openOrders}
      activeOrder={activeOrder}
      defaultReservationId={sp.reservationId ?? ""}
    />
  );
}
