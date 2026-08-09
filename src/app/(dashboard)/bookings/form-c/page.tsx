import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { can } from "@/lib/permissions";
import { listCForms } from "@/features/reservations/queries";
import { FormCRegister } from "@/features/reservations/components/form-c-register";

export const metadata: Metadata = { title: "Form C register" };

/** 03 T-37 — FRRO Form C register for the active property (FR-25/26). */
export default async function FormCPage() {
  const user = await requirePermission("reservation:view");
  const propertyId = user.activePropertyId;

  if (!propertyId) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">Select a property to see its Form C register.</p>
      </div>
    );
  }

  const { cforms } = await listCForms(user, { propertyId, limit: 50 });
  const canSubmit = can(user, "checkin:perform", propertyId);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
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
