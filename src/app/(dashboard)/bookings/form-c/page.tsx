import type { Metadata } from "next";
import { NoProperty } from "@/features/platform/components/no-property";
import { requirePermission } from "@/lib/auth/guard";
import { can, hasPermission } from "@/lib/permissions";
import { listCForms } from "@/features/reservations/queries";
import { FormCRegister } from "@/features/reservations/components/form-c-register";

export const metadata: Metadata = { title: "Form C register" };

/** 03 T-37 — FRRO Form C register for the active property (FR-25/26). */
export default async function FormCPage() {
  const user = await requirePermission("reservation:view");
  const propertyId = user.activePropertyId;

  if (!propertyId) {
    return <NoProperty what="This page" canCreate={hasPermission(user, "property:manage")} />;
  }

  const { cforms } = await listCForms(user, { propertyId, limit: 50 });
  const canSubmit = can(user, "checkin:perform", propertyId);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">Form C register</h1>
        <p className="text-sm text-muted-foreground">
          Foreign-guest arrival reports (FRRO). Record the e-FRRO reference after submitting on the portal.
        </p>
      </div>
      <FormCRegister items={cforms} canSubmit={canSubmit} />
    </div>
  );
}
