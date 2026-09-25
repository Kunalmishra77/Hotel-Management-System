import type { Metadata } from "next";
import Link from "next/link";
import { BedDouble, UserCheck, LogOut, Building2 } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { inHousePortfolio } from "@/features/reservations/queries";
import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatINR, formatDayMonth } from "@/lib/utils";

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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Guest</th>
                    <th className="py-2 px-3 font-medium">Property</th>
                    <th className="py-2 px-3 font-medium">Room</th>
                    <th className="py-2 px-3 font-medium">Guests</th>
                    <th className="py-2 px-3 font-medium">Check-in</th>
                    <th className="py-2 px-3 font-medium">Expected check-out</th>
                    <th className="py-2 px-3 text-right font-medium">Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="py-2.5 pr-3 font-medium"><Link href={`/bookings/${r.id}`} className="hover:underline">{r.guestName}</Link></td>
                      <td className="py-2.5 px-3 text-muted-foreground">{r.propertyName}</td>
                      <td className="py-2.5 px-3 font-mono text-xs">{r.rooms}</td>
                      <td className="py-2.5 px-3 tabular text-muted-foreground">{r.adults}</td>
                      <td className="py-2.5 px-3 whitespace-nowrap">{formatDayMonth(r.checkInDate)}</td>
                      <td className="py-2.5 px-3 whitespace-nowrap">{formatDayMonth(r.checkOutDate)}{isToday(r.checkOutDate) ? <span className="ml-1 text-xs text-amber-600">(today)</span> : null}</td>
                      <td className="py-2.5 px-3 text-right tabular">
                        {r.balancePaise > 0 ? <span className="font-semibold text-amber-700 dark:text-amber-400">{formatINR(r.balancePaise)} due</span> : <span className="text-success">Settled</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
