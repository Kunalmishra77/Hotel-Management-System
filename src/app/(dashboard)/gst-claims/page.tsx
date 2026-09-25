import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { InvoiceSearch } from "@/features/billing/components/invoice-search";

export const metadata: Metadata = { title: "GST Claims" };

/**
 * GST Claim register (client req #13): invoices where the guest gave a GSTIN (they
 * need the bill for a company GST claim). Search by customer/number, filter by
 * property + date; open the PDF. `folio:view` gates the route.
 */
export default async function GstClaimsPage() {
  const user = await requirePermission("folio:view");
  const ids = [...user.accessiblePropertyIds];
  const properties = ids.length
    ? await db.unscoped().property.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    : [];

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title="GST Claims" description="Invoices where the guest provided a GSTIN for a company GST claim." />
      <InvoiceSearch properties={properties} gstOnly />
    </div>
  );
}
