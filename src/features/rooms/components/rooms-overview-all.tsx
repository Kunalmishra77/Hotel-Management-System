import { BedDouble, DoorOpen, DoorClosed, CalendarClock, Sparkles, Wrench } from "lucide-react";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RoomsOverviewAll, RoomTypeRow } from "../queries";

const pct = (occupied: number, maintenance: number, total: number) => {
  const denom = total - maintenance;
  return denom > 0 ? Math.round((occupied / denom) * 100) : 0;
};

/**
 * All-properties rooms overview grouped by ROOM TYPE (02). Occupancy is derived
 * from who is actually in-house, so the counts are correct even when a room's
 * stored status is stale. A totals band on top, then an A–Z room-type table with
 * occupied / available / reserved / housekeeping / out-of-order per type.
 */
export function RoomsOverviewAllView({ data }: { data: RoomsOverviewAll }) {
  const t = data.totals;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Total rooms" value={t.total} icon={<BedDouble />} hint="Active, all hotels" />
        <KpiCard label="Occupied now" value={t.occupied} icon={<DoorOpen />} hint="Guests in-house" className="border-amber-500/30" />
        <KpiCard label="Available" value={t.available} icon={<DoorClosed />} hint="Ready to sell" className="border-emerald-500/40" />
        <KpiCard label="Reserved" value={t.reserved} icon={<CalendarClock />} hint="Held for arrivals" />
        <KpiCard label="Housekeeping" value={t.housekeeping} icon={<Sparkles />} hint="Being cleaned" />
        <KpiCard label="Out of order" value={t.maintenance} icon={<Wrench />} hint="Under maintenance" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Rooms by type — all properties</CardTitle>
          <p className="text-sm text-muted-foreground">Every property&apos;s rooms grouped by room type. &ldquo;Occupied&rdquo; is who is actually staying now; &ldquo;Available&rdquo; is ready to sell.</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Room type</th>
                  <th className="px-3 py-2 text-right font-medium">Rooms</th>
                  <th className="px-3 py-2 text-right font-medium">Occupied</th>
                  <th className="px-3 py-2 text-right font-medium">Available</th>
                  <th className="px-3 py-2 text-right font-medium">Reserved</th>
                  <th className="px-3 py-2 text-right font-medium">Housekeeping</th>
                  <th className="px-3 py-2 text-right font-medium">Out of order</th>
                  <th className="px-3 py-2 text-right font-medium">Occupancy</th>
                </tr>
              </thead>
              <tbody>
                {data.byType.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No rooms yet.</td></tr>
                ) : (
                  data.byType.map((r) => <TypeRow key={r.categoryName} r={r} />)
                )}
              </tbody>
              {data.byType.length > 0 ? (
                <tfoot>
                  <tr className="border-t-2 bg-muted/30 font-semibold">
                    <td className="px-3 py-2.5">All room types</td>
                    <td className="px-3 py-2.5 text-right tabular">{t.total}</td>
                    <td className="px-3 py-2.5 text-right tabular text-amber-700 dark:text-amber-400">{t.occupied}</td>
                    <td className="px-3 py-2.5 text-right tabular text-emerald-700 dark:text-emerald-400">{t.available}</td>
                    <td className="px-3 py-2.5 text-right tabular">{t.reserved}</td>
                    <td className="px-3 py-2.5 text-right tabular">{t.housekeeping}</td>
                    <td className="px-3 py-2.5 text-right tabular">{t.maintenance}</td>
                    <td className="px-3 py-2.5 text-right tabular">{pct(t.occupied, t.maintenance, t.total)}%</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TypeRow({ r }: { r: RoomTypeRow }) {
  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="px-3 py-2.5 font-medium">{r.categoryName}</td>
      <td className="px-3 py-2.5 text-right tabular">{r.total}</td>
      <td className="px-3 py-2.5 text-right tabular text-amber-700 dark:text-amber-400">{r.occupied}</td>
      <td className="px-3 py-2.5 text-right tabular font-medium text-emerald-700 dark:text-emerald-400">{r.available}</td>
      <td className="px-3 py-2.5 text-right tabular text-muted-foreground">{r.reserved}</td>
      <td className="px-3 py-2.5 text-right tabular text-muted-foreground">{r.housekeeping}</td>
      <td className="px-3 py-2.5 text-right tabular text-muted-foreground">{r.maintenance}</td>
      <td className="px-3 py-2.5 text-right tabular">{pct(r.occupied, r.maintenance, r.total)}%</td>
    </tr>
  );
}
