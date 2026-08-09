import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { listStaff } from "@/features/staff/queries";
import { listFieldStaffLocations } from "@/features/staff/field-queries";
import { FieldStaffScreen } from "@/features/staff/components/field-staff-screen";

export const metadata: Metadata = { title: "Field staff" };

/** 09 addendum — field-staff live locations + enable/disable tracking. staff:manage. */
export default async function FieldStaffPage() {
  const user = await requirePermission("staff:manage");
  const propertyId = user.activePropertyId;
  if (!propertyId) {
    return <div className="p-4"><p className="text-sm text-muted-foreground">Select a property to see field staff.</p></div>;
  }

  const [tracked, all] = await Promise.all([
    listFieldStaffLocations(user, propertyId),
    listStaff(user, propertyId),
  ]);
  const trackedIds = new Set(tracked.map((t) => t.staffId));
  const others = all.filter((s) => s.isActive && !trackedIds.has(s.id)).map((s) => ({ id: s.id, name: s.name, department: s.department }));

  return <FieldStaffScreen tracked={tracked} others={others} />;
}
