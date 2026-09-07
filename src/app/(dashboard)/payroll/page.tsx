import type { Metadata } from "next";
import { hasPermission } from "@/lib/permissions";
import { NoProperty } from "@/features/platform/components/no-property";
import { requirePermission } from "@/lib/auth/guard";
import { listRuns } from "@/features/payroll/queries";
import { PayrollScreen } from "@/features/payroll/components/payroll-screen";

export const metadata: Metadata = { title: "Payroll" };

/** 21 T-18 — monthly run list + generate (FR-1/2, AC-1). */
export default async function PayrollPage() {
  const user = await requirePermission("payroll:run");
  const propertyId = user.activePropertyId;
  if (!propertyId) {
    return <NoProperty what="This page" canCreate={hasPermission(user, "property:manage")} />;
  }

  const runs = await listRuns(user, propertyId);
  return <PayrollScreen propertyId={propertyId} runs={runs} />;
}
