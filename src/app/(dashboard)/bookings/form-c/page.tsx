import type { Metadata } from "next";
import { NoProperty } from "@/features/platform/components/no-property";
import { requirePermission } from "@/lib/auth/guard";
import { can, hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { listCForms, listMissingCForms } from "@/features/reservations/queries";
import { FormCRegister, MissingCForms } from "@/features/reservations/components/form-c-register";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Form C register" };

/**
 * 03 T-37 — FRRO Form C register (FR-25/26). One property, or every hotel the
 * user can see when they're in "All hotels" (client, 15 Nov 2026: the owner saw
 * only "pick a property"). Foreign guests with no Form C are listed on top.
 */
export default async function FormCPage() {
  const user = await requirePermission("reservation:view");
  const propertyIds = user.activePropertyId
    ? [user.activePropertyId]
    : (await db.scoped(user).property.findMany({ where: { id: { in: [...user.accessiblePropertyIds] }, isCostCenter: false }, select: { id: true } })).map((p) => p.id);

  if (propertyIds.length === 0) {
    return <NoProperty what="This page" canCreate={hasPermission(user, "property:manage")} />;
  }

  const [{ cforms }, missing] = await Promise.all([
    listCForms(user, { propertyId: propertyIds, limit: 100 }),
    listMissingCForms(user, propertyIds),
  ]);
  const canSubmit = propertyIds.some((id) => can(user, "checkin:perform", id));

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 p-4">
      <PageHeader
        title="Form C register"
        description="Foreign-guest arrival reports (FRRO). Record the e-FRRO reference after submitting on the portal."
      />
      <MissingCForms items={missing} canFill={canSubmit} />
      <FormCRegister items={cforms} canSubmit={canSubmit} />
    </div>
  );
}
