import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { listRuns } from "@/features/payroll/queries";
import { PayrollScreen } from "@/features/payroll/components/payroll-screen";

export const metadata: Metadata = { title: "Payroll" };

/** 21 T-18 — monthly run list + generate (FR-1/2, AC-1). */
export default async function PayrollPage() {
  const user = await requirePermission("payroll:run");
  const propertyId = user.activePropertyId;
  if (!propertyId) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">Select a property to run payroll.</p>
      </div>
    );
  }

  const runs = await listRuns(user, propertyId);
  return <PayrollScreen propertyId={propertyId} runs={runs} />;
}
