import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { can } from "@/lib/permissions";
import { listStaff, staffOverview } from "@/features/staff/queries";
import { latestRunByProperty, listRuns } from "@/features/payroll/queries";
import { StaffScreen } from "@/features/staff/components/staff-screen";
import { PayrollScreen } from "@/features/payroll/components/payroll-screen";
import { PeopleOverview } from "@/features/staff/components/people-overview";
import { PeopleTabs } from "@/features/staff/components/people-tabs";
import { BackToAllProperties } from "@/features/platform/components/back-to-all-properties";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "People" };

/**
 * ⑧ People — Staff + Payroll merged (Phase-3). All-hotels: a cross-property team
 * overview (headcount, present, salary cost, payroll state) whose cards scope the
 * app to a property. Focused on one property: Staff & attendance + Payroll under
 * one tab strip. Base gate `attendance:record`; the Payroll tab is `payroll:run`.
 */
export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requirePermission("attendance:record");
  const propertyId = user.activePropertyId;

  // All-hotels (no focused property) → the cross-property overview. Old /staff and
  // /payroll routes with no active property also land here.
  if (!propertyId) {
    const ids = [...user.accessiblePropertyIds];
    const [staff, runs] = await Promise.all([staffOverview(user, ids), latestRunByProperty(user, ids)]);
    const runById = new Map(runs.map((r) => [r.propertyId, r]));
    const cards = staff.map((s) => {
      const r = runById.get(s.propertyId);
      return {
        propertyId: s.propertyId,
        propertyName: s.propertyName,
        headcount: s.headcount,
        presentToday: s.presentToday,
        monthlySalaryPaise: s.monthlySalaryPaise,
        payrollMonth: r?.month ?? null,
        payrollStatus: r?.status ?? null,
        payrollNetPaise: r?.netTotalPaise ?? null,
      };
    });
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-4">
        <PageHeader title="People" description="Your team across every property — staff, attendance and payroll." />
        <PeopleOverview cards={cards} />
      </div>
    );
  }

  // Focused property → operational tabs.
  const canPayroll = can(user, "payroll:run", propertyId);
  const [staff, runs] = await Promise.all([
    listStaff(user, propertyId),
    canPayroll ? listRuns(user, propertyId) : Promise.resolve([]),
  ]);
  const canManage = can(user, "staff:manage", propertyId);
  const canUpdateSalary = can(user, "staff:salary-update", propertyId);
  const defaultTab = (await searchParams).tab === "payroll" ? "payroll" : "staff";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <PageHeader title="People" description="Staff, attendance and payroll for this property." />
        <BackToAllProperties />
      </div>
      <PeopleTabs
        defaultTab={defaultTab}
        staffSlot={<StaffScreen propertyId={propertyId} staff={staff} canManage={canManage} canUpdateSalary={canUpdateSalary} />}
        payrollSlot={canPayroll ? <PayrollScreen propertyId={propertyId} runs={runs} /> : null}
      />
    </div>
  );
}
