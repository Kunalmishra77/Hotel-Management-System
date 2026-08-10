import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { listTasks, housekeepingOverview } from "@/features/housekeeping/queries";
import { HousekeepingBoard } from "@/features/housekeeping/components/housekeeping-board";

export const metadata: Metadata = { title: "Housekeeping" };

/** 10 T-10 — the offline-aware cleaning task board (FR-2/3/4, AC-1/2/4). */
export default async function HousekeepingPage() {
  const user = await requirePermission("housekeeping:update");
  const propertyId = user.activePropertyId;
  if (!propertyId) {
    return <div className="p-4"><p className="text-sm text-muted-foreground">Select a property to see housekeeping tasks.</p></div>;
  }
  const [tasks, overview] = await Promise.all([
    listTasks(user, propertyId),
    housekeepingOverview(user, propertyId),
  ]);
  return <HousekeepingBoard tasks={tasks} overview={overview} />;
}
