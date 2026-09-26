import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { listJobs, maintenanceOverview, maintenancePortfolio } from "@/features/maintenance/queries";
import { MaintenanceScreen } from "@/features/maintenance/components/maintenance-screen";
import { OpsPropertyCards } from "@/features/platform/components/ops-property-cards";
import { BackToAllProperties } from "@/features/platform/components/back-to-all-properties";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Maintenance" };

/**
 * 11 T-10 — maintenance job board (FR-1/5, AC-1/4). Phase-3 ⑨: all-hotels shows a
 * per-property open-work chooser (open / urgent / rooms blocked) instead of the old
 * "create a property" dead-end; picking one opens its board. Switching from the
 * top-bar selector works too.
 */
export default async function MaintenancePage() {
  const user = await requirePermission("maintenance:manage");
  const propertyId = user.activePropertyId;

  // All hotels: the open-work chooser across every property.
  if (!propertyId) {
    const rows = await maintenancePortfolio(user, [...user.accessiblePropertyIds]);
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-4">
        <PageHeader title="Maintenance" description="Repair & upkeep jobs across all properties. Pick a hotel to manage its jobs." />
        <OpsPropertyCards
          what="maintenance"
          cards={rows.map((r) => ({
            propertyId: r.propertyId,
            propertyName: r.propertyName,
            stats: [
              { label: "Open", value: r.open, tone: r.open > 0 ? "warn" : "good" },
              { label: "Urgent", value: r.urgent, tone: r.urgent > 0 ? "bad" : undefined },
              { label: "Rooms blocked", value: r.roomsBlocked, tone: r.roomsBlocked > 0 ? "bad" : undefined },
            ],
          }))}
        />
      </div>
    );
  }

  const [jobs, overview] = await Promise.all([
    listJobs(user, { propertyId }),
    maintenanceOverview(user, propertyId),
  ]);
  return (
    <div className="space-y-2">
      <div className="mx-auto w-full max-w-2xl px-4 pt-4"><BackToAllProperties /></div>
      <MaintenanceScreen propertyId={propertyId} jobs={jobs} overview={overview} />
    </div>
  );
}
