import type { Metadata } from "next";
import { ReceiptText, Wallet, HandCoins, FileText } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/permissions";
import { NoProperty } from "@/features/platform/components/no-property";
import { billingOverview, listBillingFolios } from "@/features/billing/queries";
import { listProperties } from "@/features/properties/queries";
import { resolvePortal } from "@/features/platform/portals";
import { perPropertyBillingRollup } from "@/features/command-center/queries";
import { PortfolioBilling } from "@/features/command-center/components/portfolio-billing";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { InvoiceSearch } from "@/features/billing/components/invoice-search";
import { OpenFoliosTable } from "@/features/billing/components/open-folios-table";
import { formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Billing" };

/**
 * 06 — Billing home. All-hotels: a per-property dues/collections rollup. Focused on
 * one property: its dues + open folios. Both show the searchable/filterable invoice
 * register (property · date · All-invoices / GST-claims tabs) with share. GST claims
 * are a tab here (merged from the old standalone page). `folio:view`, server-enforced.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requirePermission("folio:view");
  const properties = (await listProperties(user)).map((p) => ({ id: p.id, name: p.name }));
  const gstTab = (await searchParams).tab === "gst"; // old /gst-claims links land here

  // All-hotels: portfolio rollup + the invoice register across every property.
  if (resolvePortal(user.roleAssignments.map((r) => r.role)) === "SUPER_ADMIN" && !user.activePropertyId) {
    const rollup = await perPropertyBillingRollup(user, [...user.accessiblePropertyIds]);
    return (
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <PortfolioBilling rollup={rollup} properties={properties} />
        <div id="invoices" className="scroll-mt-20">
          <InvoiceSearch properties={properties} gstOnly={gstTab} />
        </div>
      </div>
    );
  }

  const propertyId = user.activePropertyId;
  if (!propertyId) {
    return <NoProperty what="Billing" canCreate={hasPermission(user, "property:manage")} />;
  }

  const [overview, folios] = await Promise.all([
    billingOverview(user, propertyId),
    listBillingFolios(user, { propertyId, limit: 50 }),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title="Billing" description="Outstanding dues, collections and GST tax invoices for this property." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="billing-kpis">
        <KpiCard label="Outstanding dues" value={formatINR(overview.outstandingPaise)} icon={<Wallet />} hint="Balance to collect" tooltip="Money guests still owe — Σ folio balances (charges + tax − payments)." trend={overview.outstandingPaise > 0 ? "down" : "up"} />
        <KpiCard label="Unsettled folios" value={String(overview.unsettledFolios)} icon={<ReceiptText />} hint="With a balance" />
        <KpiCard label="Collected today" value={formatINR(overview.collectedTodayPaise)} icon={<HandCoins />} hint="Payments received" />
        <KpiCard label="Invoices this month" value={String(overview.invoicesThisMonth)} icon={<FileText />} hint="GST invoices issued" href="#invoices" />
      </div>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Guest accounts &amp; folios</h2>
        <p className="mb-2 text-xs text-muted-foreground">Every checked-in or charged stay, open balances first. Tap a row to open its folio.</p>
        <OpenFoliosTable folios={folios} />
      </section>

      <section id="invoices" className="mt-6 scroll-mt-20">
        <InvoiceSearch properties={properties} gstOnly={gstTab} />
      </section>
    </div>
  );
}
