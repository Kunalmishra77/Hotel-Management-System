import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { can } from "@/lib/permissions";
import { listOwnerPayouts, getManagementFeeBps } from "@/features/owner-portal/queries";
import { PayoutList } from "@/features/owner-portal/components/payout-list";

export const metadata: Metadata = { title: "Payouts" };

/** 27 owner-portal — owner payout statements + (for staff) record/mark-paid. */
export default async function OwnerPayoutsPage() {
  const user = await requirePermission("owner:view-payout");
  const propertyId = user.activePropertyId;

  if (!propertyId) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">Select a property to see its payouts.</p>
      </div>
    );
  }

  const [payouts, feeBps] = await Promise.all([
    listOwnerPayouts(user, { propertyId }),
    getManagementFeeBps(user, propertyId),
  ]);
  const canManage = can(user, "owner:payout-manage", propertyId);
  const canManageFee = can(user, "owner:manage", propertyId);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">Payouts</h1>
        <p className="text-sm text-muted-foreground">
          Monthly owner payout = revenue − operating expenses − management fee.
        </p>
      </div>
      <PayoutList
        propertyId={propertyId}
        payouts={payouts}
        canManage={canManage}
        canManageFee={canManageFee}
        feeBps={feeBps}
      />
    </div>
  );
}
