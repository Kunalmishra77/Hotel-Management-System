import type { Metadata } from "next";
import { hasPermission } from "@/lib/permissions";
import { NoProperty } from "@/features/platform/components/no-property";
import { requirePermission } from "@/lib/auth/guard";
import { listJobs, maintenanceOverview } from "@/features/maintenance/queries";
import { MaintenanceScreen } from "@/features/maintenance/components/maintenance-screen";

export const metadata: Metadata = { title: "Maintenance" };

/** 11 T-10 — maintenance job board (FR-1/5, AC-1/4). */
export default async function MaintenancePage() {
  const user = await requirePermission("maintenance:manage");
  const propertyId = user.activePropertyId;
  if (!propertyId) {
    return <NoProperty what="This page" canCreate={hasPermission(user, "property:manage")} />;
  }
  const [jobs, overview] = await Promise.all([
    listJobs(user, { propertyId }),
    maintenanceOverview(user, propertyId),
  ]);
  return <MaintenanceScreen propertyId={propertyId} jobs={jobs} overview={overview} />;
}
