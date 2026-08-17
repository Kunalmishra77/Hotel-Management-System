import Link from "next/link";
import { CalendarDays, CalendarCheck, BedDouble, XCircle, UserX, AlertTriangle, TrendingUp, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { TrendChart } from "@/components/ui/charts/trend-chart";
import { BreakdownList } from "@/components/ui/charts/breakdown-list";
import type { BookingsOverview } from "../queries";

const SOURCE_LABEL: Record<string, string> = {
  WALK_IN: "Walk-in", DIRECT: "Direct", WEBSITE: "Website", PHONE: "Phone", CORPORATE: "Corporate",
  TRAVEL_AGENT: "Travel agent", BOOKING_COM: "Booking.com", MAKEMYTRIP: "MakeMyTrip", GOIBIBO: "Goibibo",
  AGODA: "Agoda", AIRBNB: "Airbnb",
};
const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s.replace(/_/g, " ").toLowerCase();

const FUNNEL: { key: string; label: string; tone: string }[] = [
  { key: "ENQUIRY", label: "Enquiry / hold", tone: "bg-muted text-muted-foreground" },
  { key: "CONFIRMED", label: "Confirmed", tone: "bg-warning/12 text-warning" },
  { key: "IN_HOUSE", label: "In-house", tone: "bg-success/12 text-success" },
  { key: "CHECKED_OUT", label: "Checked out", tone: "bg-primary/10 text-primary" },
  { key: "CANCELLED", label: "Cancelled", tone: "bg-destructive/10 text-destructive" },
  { key: "NO_SHOW", label: "No-show", tone: "bg-destructive/10 text-destructive" },
];

/**
 * Manager's Bookings view — performance & insights, NOT the front desk's
 * operational board. Booking volume, the lifecycle funnel, an occupancy trend,
 * source mix and cancellations. Branched by portal so the same route reads
 * completely differently for a Manager than for Reception.
 */
export function ManagerBookings({
  overview,
  occupancyTrend,
  dateLabel,
}: {
  overview: BookingsOverview;
  occupancyTrend: { label: string; value: number }[];
  dateLabel: string;
}) {
  const realised = (overview.statusCounts["CONFIRMED"] ?? 0) + (overview.statusCounts["IN_HOUSE"] ?? 0) + (overview.statusCounts["CHECKED_OUT"] ?? 0);
  const lost = (overview.statusCounts["CANCELLED"] ?? 0) + (overview.statusCounts["NO_SHOW"] ?? 0);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Bookings — performance"
        description={`Insights & trends · ${dateLabel}`}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm"><Link href="/reports"><TrendingUp className="mr-1.5 size-4" />Reports</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/overview">Command centre <ArrowRight className="ml-1.5 size-4" /></Link></Button>
          </div>
        }
      />

      {/* Booking performance KPI band */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Booked this month" value={overview.monthBookings} icon={<CalendarDays />} hint="New reservations" href="/reports" />
        <KpiCard label="Realised" value={realised} icon={<CalendarCheck />} hint="Confirmed + stayed" goodDirection="up" />
        <KpiCard label="In-house" value={overview.inHouse} icon={<BedDouble />} hint="Staying now" href="/in-house" />
        <KpiCard label="Cancelled" value={overview.statusCounts["CANCELLED"] ?? 0} icon={<XCircle />} hint="This period" goodDirection="down" className={(overview.statusCounts["CANCELLED"] ?? 0) > 0 ? "border-destructive/30" : undefined} />
        <KpiCard label="No-show" value={overview.statusCounts["NO_SHOW"] ?? 0} icon={<UserX />} hint="This period" goodDirection="down" />
        <KpiCard label="Needs attention" value={overview.needsAttention} icon={<AlertTriangle />} hint="OTA oversell" href="/bookings" className={overview.needsAttention > 0 ? "border-warning/40" : undefined} />
      </div>

      {/* Lifecycle funnel */}
      <div className="mt-4 flex flex-wrap gap-2">
        {FUNNEL.map((s) => (
          <span key={s.key} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${s.tone}`}>
            {s.label}<span className="tabular font-semibold">{overview.statusCounts[s.key] ?? 0}</span>
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
          Realised vs lost<span className="tabular font-semibold text-foreground">{realised}</span>/<span className="tabular font-semibold text-destructive">{lost}</span>
        </span>
      </div>

      {/* Occupancy trend + source mix */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base">Occupancy — last 14 days</CardTitle>
            <Link href="/overview" className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">Command centre <ArrowRight className="size-3.5" aria-hidden="true" /></Link>
          </CardHeader>
          <CardContent>
            {occupancyTrend.length > 0 ? (
              <TrendChart data={occupancyTrend} format="percent" height={200} />
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">No occupancy data in range yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Where bookings come from</CardTitle></CardHeader>
          <CardContent>
            <BreakdownList
              items={overview.sourceMix.map((s) => ({ label: sourceLabel(s.source), value: s.count }))}
              format="number"
              emptyLabel="No bookings yet."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
