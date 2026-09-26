import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { listTasks, housekeepingOverview, housekeepingPortfolio } from "@/features/housekeeping/queries";
import { HousekeepingBoard } from "@/features/housekeeping/components/housekeeping-board";
import { OpsPropertyCards } from "@/features/platform/components/ops-property-cards";
import { BackToAllProperties } from "@/features/platform/components/back-to-all-properties";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Housekeeping" };

/**
 * 10 T-10 — the offline-aware cleaning task board (FR-2/3/4, AC-1/2/4). Phase-3 ⑨:
 * all-hotels shows a per-property pending-work chooser (rooms to clean / in-progress
 * / complaints) instead of the old "create a property" dead-end; picking one opens
 * its board. Switching from the top-bar selector works too.
 */
export default async function HousekeepingPage() {
  const user = await requirePermission("housekeeping:update");
  const propertyId = user.activePropertyId;

  // All hotels: the pending-work chooser across every property.
  if (!propertyId) {
    const rows = await housekeepingPortfolio(user, [...user.accessiblePropertyIds]);
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-4">
        <PageHeader title="Housekeeping" description="Room readiness across all properties. Pick a hotel to manage its cleaning board." />
        <OpsPropertyCards
          what="housekeeping"
          cards={rows.map((r) => ({
            propertyId: r.propertyId,
            propertyName: r.propertyName,
            stats: [
              { label: "To clean", value: r.toClean, tone: r.toClean > 0 ? "warn" : "good" },
              { label: "In progress", value: r.inProgress },
              { label: "Complaints", value: r.complaints, tone: r.complaints > 0 ? "bad" : undefined },
            ],
          }))}
        />
      </div>
    );
  }

  const [tasks, overview] = await Promise.all([
    listTasks(user, propertyId),
    housekeepingOverview(user, propertyId),
  ]);
  return (
    <div className="space-y-2">
      <div className="mx-auto w-full max-w-2xl px-4 pt-4"><BackToAllProperties /></div>
      <HousekeepingBoard tasks={tasks} overview={overview} />
    </div>
  );
}
