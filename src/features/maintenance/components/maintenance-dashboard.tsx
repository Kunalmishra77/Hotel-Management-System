import Link from "next/link";
import { Wrench, Boxes, Wrench as WrenchIcon, Loader, AlertTriangle, CalendarClock, DoorClosed, CheckCircle2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import type { MaintenanceOverview } from "../queries";

/**
 * Maintenance command centre — the operational home for the maintenance team:
 * open and urgent jobs, preventive work due, rooms blocked out of order. Launches
 * into the jobs board. Branched by resolvePortal() === MAINTENANCE.
 */
export function MaintenanceDashboard({
  name,
  overview,
  canAssets,
}: {
  name: string;
  overview: MaintenanceOverview;
  canAssets: boolean;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={`Maintenance — welcome, ${name}`} description="Jobs, preventive schedule and out-of-order rooms" />

      <div className="flex flex-wrap gap-2">
        <Button asChild size="lg"><Link href="/maintenance"><Wrench /><span className="ml-1.5">Jobs board</span></Link></Button>
        {canAssets ? <Button asChild size="lg" variant="outline"><Link href="/assets"><Boxes /><span className="ml-1.5">Assets</span></Link></Button> : null}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Open jobs" value={overview.open} icon={<WrenchIcon />} hint="Awaiting work" href="/maintenance" className={overview.open > 0 ? "border-warning/40" : undefined} />
        <KpiCard label="In progress" value={overview.inProgress} icon={<Loader />} hint="Being worked" href="/maintenance" />
        <KpiCard label="Urgent" value={overview.urgent} icon={<AlertTriangle />} hint="High priority" href="/maintenance" className={overview.urgent > 0 ? "border-destructive/40" : undefined} />
        <KpiCard label="Preventive due" value={overview.preventiveDue} icon={<CalendarClock />} hint="Next 7 days" href="/maintenance" />
        <KpiCard label="Rooms blocked" value={overview.roomsBlocked} icon={<DoorClosed />} hint="Out of order" href="/rooms" />
        <KpiCard label="Closed" value={overview.closed} icon={<CheckCircle2 />} hint="This month" href="/maintenance" />
      </div>

      <Card>
        <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
          <div>
            <p className="font-semibold">Your jobs board</p>
            <p className="text-sm text-muted-foreground">Log, assign and close jobs; track the preventive-maintenance schedule.</p>
          </div>
          <Button asChild><Link href="/maintenance">Open board <ArrowRight className="ml-1.5 size-4" aria-hidden="true" /></Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
