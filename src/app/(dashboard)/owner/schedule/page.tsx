import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { can } from "@/lib/permissions";
import { ownerSchedule } from "@/features/owner-portal/queries";
import { ScheduleView } from "@/features/owner-portal/components/schedule-view";

export const metadata: Metadata = { title: "Schedule" };

/** 27 owner-portal — compliance dates + maintenance + occupancy. owner:view-schedule. */
export default async function OwnerSchedulePage() {
  const user = await requirePermission("owner:view-schedule");
  const propertyId = user.activePropertyId;

  if (!propertyId) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">Select a property to see its schedule.</p>
      </div>
    );
  }

  const today = new Date();
  const from = new Date(today.getTime() - 29 * 86_400_000);
  const schedule = await ownerSchedule(user, { propertyId, from, to: today });
  const canManage = can(user, "owner:manage", propertyId);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">Schedule</h1>
        <p className="text-sm text-muted-foreground">Renewals, upcoming maintenance, and recent occupancy.</p>
      </div>
      <ScheduleView propertyId={propertyId} schedule={schedule} canManage={canManage} />
    </div>
  );
}
