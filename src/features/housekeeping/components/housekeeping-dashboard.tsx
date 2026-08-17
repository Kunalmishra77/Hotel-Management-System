import Link from "next/link";
import { Sparkles, DoorOpen, PackageSearch, BedDouble, Loader, CheckCircle2, MessageSquareWarning, Wrench, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import type { HousekeepingOverview } from "../queries";

/**
 * Housekeeping command centre — the operational home for the cleaning team:
 * what's to clean, in progress and done, plus complaints and maintenance raised.
 * Mobile-first; launches into the cleaning board. Branched by resolvePortal().
 */
export function HousekeepingDashboard({
  name,
  overview,
  canRooms,
}: {
  name: string;
  overview: HousekeepingOverview;
  canRooms: boolean;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={`Housekeeping — welcome, ${name}`} description="Rooms to clean, linen and complaints" />

      <div className="flex flex-wrap gap-2">
        <Button asChild size="lg"><Link href="/housekeeping"><Sparkles /><span className="ml-1.5">Cleaning board</span></Link></Button>
        {canRooms ? <Button asChild size="lg" variant="outline"><Link href="/rooms"><DoorOpen /><span className="ml-1.5">Room board</span></Link></Button> : null}
        <Button asChild size="lg" variant="outline"><Link href="/lost-found"><PackageSearch /><span className="ml-1.5">Lost &amp; found</span></Link></Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="To clean" value={overview.toClean} icon={<BedDouble />} hint="Pending rooms" href="/housekeeping" className={overview.toClean > 0 ? "border-warning/40" : undefined} />
        <KpiCard label="In progress" value={overview.inProgress} icon={<Loader />} hint="Being cleaned" href="/housekeeping" />
        <KpiCard label="Done today" value={overview.done} icon={<CheckCircle2 />} hint="Completed" href="/housekeeping" />
        <KpiCard label="Complaints" value={overview.complaints} icon={<MessageSquareWarning />} hint="Open" className={overview.complaints > 0 ? "border-destructive/40" : undefined} />
        <KpiCard label="Maintenance raised" value={overview.maintenanceRaised} icon={<Wrench />} hint="From housekeeping" href="/maintenance" />
      </div>

      <Card>
        <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
          <div>
            <p className="font-semibold">Your cleaning board</p>
            <p className="text-sm text-muted-foreground">Update room status, linen and towels — works offline on weak Wi-Fi.</p>
          </div>
          <Button asChild><Link href="/housekeeping">Open board <ArrowRight className="ml-1.5 size-4" aria-hidden="true" /></Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
