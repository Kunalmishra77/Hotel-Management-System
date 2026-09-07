import type { Metadata } from "next";
import { NoProperty } from "@/features/platform/components/no-property";
import { requirePermission } from "@/lib/auth/guard";
import { can, hasPermission } from "@/lib/permissions";
import { listStaff } from "@/features/staff/queries";
import { StaffScreen } from "@/features/staff/components/staff-screen";

export const metadata: Metadata = { title: "Staff" };

/**
 * 09 T-12/T-13 — staff list (masked) + attendance (FR-1/3/7, AC-1/4/5).
 * MoM: reception reaches this with attendance:record to log attendance + salary;
 * full staff CRUD (add/deactivate/edit PII) stays staff:manage-gated in the UI + server.
 */
export default async function StaffPage() {
  const user = await requirePermission("attendance:record");
  const propertyId = user.activePropertyId;
  if (!propertyId) {
    return <NoProperty what="This page" canCreate={hasPermission(user, "property:manage")} />;
  }
  const staff = await listStaff(user, propertyId);
  const canManage = can(user, "staff:manage", propertyId);
  const canUpdateSalary = can(user, "staff:salary-update", propertyId);
  return <StaffScreen propertyId={propertyId} staff={staff} canManage={canManage} canUpdateSalary={canUpdateSalary} />;
}
