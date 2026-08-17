import Link from "next/link";
import { Boxes, Shirt, PackageX, TriangleAlert, Package, WashingMachine, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import type { InventoryOverview } from "../queries";

/**
 * Store / Inventory command centre — the operational home for stock: totals, low
 * and out-of-stock alerts, open laundry batches, and the six stock domains.
 * Launches into the inventory screen. Branched by resolvePortal() === STORE.
 */
export function StoreDashboard({
  name,
  overview,
}: {
  name: string;
  overview: InventoryOverview;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={`Store & Inventory — welcome, ${name}`} description="Stock levels, alerts and laundry reconciliation" />

      <div className="flex flex-wrap gap-2">
        <Button asChild size="lg"><Link href="/inventory"><Boxes /><span className="ml-1.5">Inventory</span></Link></Button>
        <Button asChild size="lg" variant="outline"><Link href="/inventory/laundry"><Shirt /><span className="ml-1.5">Laundry</span></Link></Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
        <KpiCard label="Total items" value={overview.totalItems} icon={<Package />} hint="Tracked SKUs" href="/inventory" />
        <KpiCard label="Low stock" value={overview.lowStock} icon={<TriangleAlert />} hint="Below reorder" href="/inventory" className={overview.lowStock > 0 ? "border-warning/40" : undefined} />
        <KpiCard label="Out of stock" value={overview.outOfStock} icon={<PackageX />} hint="Reorder now" href="/inventory" className={overview.outOfStock > 0 ? "border-destructive/40" : undefined} />
        <KpiCard label="Open laundry" value={overview.openLaundryBatches} icon={<WashingMachine />} hint="Batches out" href="/inventory/laundry" />
      </div>

      {overview.byDomain.length > 0 ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Stock by domain</CardTitle>
            <Link href="/inventory" className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
              Inventory <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {overview.byDomain.map((d) => (
                <Link key={d.domain} href="/inventory" className="u-lift rounded-lg border bg-card p-3">
                  <div className="font-display text-xl font-bold tabular leading-none">{d.count}</div>
                  <div className="mt-0.5 truncate text-xs capitalize text-muted-foreground">{d.domain.toLowerCase()}</div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
