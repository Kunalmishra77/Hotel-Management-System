import type { Metadata } from "next";
import { BedDouble, UserCheck, LogOut, Building2 } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { inHousePortfolio } from "@/features/reservations/queries";
import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InHouseTable } from "@/features/reservations/components/in-house-table";
import { formatINR } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "In-house guests" };

const isToday = (d: Date): boolean => new Date(d).toDateString() === new Date().toDateString();

/**
 * In-house guests (client req #8) — a complete, portfolio-wide overview: every
 * currently-staying guest across all four properties, per-property counts, room,
 * dates, and payment status (folio balance). One centralized admin view.
 */
export default async function InHousePage() {
  const user = await requirePermission("reservation:view");
  // Honor the header property picker: a focused property shows only its in-house
  // guests; "All hotels" shows the whole portfolio.
  const scope = user.activePropertyId ? [user.activePropertyId] : [...user.accessiblePropertyIds];
  const { rows, total, byProperty } = await inHousePortfolio(user, scope);
  const leavingToday = rows.filter((r) => isToday(r.checkOutDate)).length;
  const duePaise = rows.reduce((n, r) => n + Math.max(0, r.balancePaise), 0);

  return (
    <div className="mx-auto w-full max-w-6xl px-1 py-1">
      <PageHeader title="In-house guests" description={`${total} guest${total === 1 ? "" : "s"} currently staying across all properties.`} />

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="In-house now" value={total} icon={<UserCheck />} hint="currently staying" />
        <KpiCard label="Leaving today" value={leavingToday} icon={<LogOut />} hint="due to check out" />
        <KpiCard label="Properties occupied" value={byProperty.length} icon={<Building2 />} hint="with guests in-house" />
        <KpiCard label="Balance due" value={formatINR(duePaise)} icon={<BedDouble />} hint="across in-house folios" trend={duePaise > 0 ? "down" : "up"} />
      </div>

      {byProperty.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {byProperty.map((p) => (
            <Badge key={p.propertyId} variant="secondary">{p.propertyName}: {p.count}</Badge>
          ))}
        </div>
      )}

      <Card className="mt-6">
        <CardHeader className="pb-2"><CardTitle className="text-base">Currently staying</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-muted/30 p-12 text-center">
              <BedDouble className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium">No guests in-house</p>
              <p className="mt-1 text-sm text-muted-foreground">Checked-in guests across every property will appear here.</p>
            </div>
          ) : (
            <InHouseTable
              rows={rows.map((r) => ({
                id: r.id, guestName: r.guestName, propertyName: r.propertyName, rooms: r.rooms,
                adults: r.adults, checkInDate: r.checkInDate.toISOString(), checkOutDate: r.checkOutDate.toISOString(),
                balancePaise: r.balancePaise,
              }))}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
