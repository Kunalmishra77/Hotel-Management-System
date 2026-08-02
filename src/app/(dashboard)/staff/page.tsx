import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { listStaff } from "@/features/staff/queries";
import { StaffScreen } from "@/features/staff/components/staff-screen";

export const metadata: Metadata = { title: "Staff" };

/** 09 T-12/T-13 — staff list (masked) + attendance (FR-1/3/7, AC-1/4/5). */
export default async function StaffPage() {
  const user = await requirePermission("staff:manage");
  const propertyId = user.activePropertyId;
  if (!propertyId) {
    return <div className="p-4"><p className="text-sm text-muted-foreground">Select a property to manage staff.</p></div>;
  }
  const staff = await listStaff(user, propertyId);
  return <StaffScreen propertyId={propertyId} staff={staff} />;
}
