import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { NoProperty } from "@/features/platform/components/no-property";
import { listProperties } from "@/features/properties/queries";
import { getManualBill } from "@/features/billing/manual-bill-queries";
import { ManualBillForm } from "@/features/billing/components/manual-bill-form";

export const metadata: Metadata = { title: "Manual bill" };

/**
 * Billing → Manual bill (specs/06 FR-MB-1): a GST bill for a customer who did not
 * stay. `?invoice=<id>` opens an existing manual bill to correct it (same number).
 * `invoice:generate`, server-enforced again in the actions.
 */
export default async function ManualBillPage({ searchParams }: { searchParams: Promise<{ invoice?: string }> }) {
  const user = await requirePermission("invoice:generate");
  const properties = (await listProperties(user)).map((p) => ({ id: p.id, name: p.name }));
  if (properties.length === 0) return <NoProperty what="Manual bills" canCreate={hasPermission(user, "property:manage")} />;
  const { invoice } = await searchParams;
  const draft = invoice ? await getManualBill(user, invoice) : null;
  if (invoice && !draft) notFound();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const defaultPropertyId = user.activePropertyId && properties.some((p) => p.id === user.activePropertyId) ? user.activePropertyId : properties[0]!.id;
  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader
        title={draft ? `Correct bill ${draft.number}` : "Manual bill"}
        description={draft ? "Change anything below — the bill keeps its number." : "A GST bill for a customer who didn't stay, or anything billed outside a booking. Rooms and availability are not touched."}
      />
      <ManualBillForm properties={properties} defaultPropertyId={defaultPropertyId} today={today} draft={draft} />
    </div>
  );
}
