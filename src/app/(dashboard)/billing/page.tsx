import type { Metadata } from "next";
import { ModulePlaceholder } from "@/features/platform/components/module-placeholder";
import { requirePermission } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage() {
  // FR-13: enforced server-side — hiding the nav item is not security.
  await requirePermission("folio:view");

  return (
    <ModulePlaceholder
      title="Billing"
      module="06-billing-payments"
      summary="Folios, charges, payments and GST invoices."
    />
  );
}
