import Link from "next/link";
import { UtensilsCrossed, ChefHat, Receipt, IndianRupee, QrCode, Store, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/ui/kpi-card";

const inr = (p: number) => `₹${Math.round(p / 100).toLocaleString("en-IN")}`;

/**
 * Outlet / POS command centre — the operational home for the point of sale: open
 * orders and their value, guest QR room-orders awaiting accept, live kitchen
 * tickets, and outlets. Launches into the POS. Branched by resolvePortal() === OUTLET.
 */
export function OutletDashboard({
  name,
  openOrders,
  openValuePaise,
  roomOrdersPending,
  kitchenTickets,
  outlets,
}: {
  name: string;
  openOrders: number;
  openValuePaise: number;
  roomOrdersPending: number;
  kitchenTickets: number;
  outlets: number;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={`Point of Sale — welcome, ${name}`} description="Orders, kitchen tickets and outlets" />

      <div className="flex flex-wrap gap-2">
        <Button asChild size="lg"><Link href="/pos"><UtensilsCrossed /><span className="ml-1.5">Open POS</span></Link></Button>
        <Button asChild size="lg" variant="outline"><Link href="/pos/kitchen"><ChefHat /><span className="ml-1.5">Kitchen display</span></Link></Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Open orders" value={openOrders} icon={<Receipt />} hint="In progress" href="/pos" className={openOrders > 0 ? "border-warning/40" : undefined} />
        <KpiCard label="Open value" value={inr(openValuePaise)} icon={<IndianRupee />} hint="Unbilled" href="/pos" />
        <KpiCard label="Room orders" value={roomOrdersPending} icon={<QrCode />} hint="Awaiting accept" href="/pos" className={roomOrdersPending > 0 ? "border-destructive/40" : undefined} />
        <KpiCard label="Kitchen tickets" value={kitchenTickets} icon={<ChefHat />} hint="Active" href="/pos/kitchen" />
        <KpiCard label="Outlets" value={outlets} icon={<Store />} hint="Active" href="/pos" />
      </div>

      <Card>
        <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
          <div>
            <p className="font-semibold">Point of sale</p>
            <p className="text-sm text-muted-foreground">Take orders, accept guest QR room-orders, and settle to the folio.</p>
          </div>
          <Button asChild><Link href="/pos">Open POS <ArrowRight className="ml-1.5 size-4" aria-hidden="true" /></Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
