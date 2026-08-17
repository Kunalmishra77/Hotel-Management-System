import type { Metadata } from "next";
import { ReceiptText, Wallet, HandCoins, FileText } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { billingOverview, searchInvoices } from "@/features/billing/queries";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { InvoicesTable } from "@/features/billing/components/invoices-table";
import { formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Billing" };

/**
 * 06 — Billing home for the active property: outstanding dues + the recent GST
 * invoice register. `folio:view` gates the route (FR-13, enforced server-side).
 * Money figures come straight from the folio/invoice queries — never recomputed.
 * Per-reservation folios open from a booking (`/bookings/[id]/folio`).
 */
export default async function BillingPage() {
  const user = await requirePermission("folio:view");
  const propertyId = user.activePropertyId;

  if (!propertyId) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">Select a property to see its billing.</p>
      </div>
    );
  }

  const [overview, { invoices }] = await Promise.all([
    billingOverview(user, propertyId),
    searchInvoices(user, { propertyId, limit: 25 }),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title="Billing" description="Outstanding dues, collections and GST tax invoices for this property." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="billing-kpis">
        <KpiCard
          label="Outstanding dues"
          value={formatINR(overview.outstandingPaise)}
          icon={<Wallet />}
          hint="Balance to collect"
          trend={overview.outstandingPaise > 0 ? "down" : "up"}
        />
        <KpiCard label="Unsettled folios" value={String(overview.unsettledFolios)} icon={<ReceiptText />} hint="With a balance" />
        <KpiCard label="Collected today" value={formatINR(overview.collectedTodayPaise)} icon={<HandCoins />} hint="Payments received" />
        <KpiCard label="Invoices this month" value={String(overview.invoicesThisMonth)} icon={<FileText />} hint="GST invoices issued" href="#invoices" />
      </div>

      <section id="invoices" className="mt-6 scroll-mt-20">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">GST invoices</h2>
        <InvoicesTable invoices={invoices} />
      </section>
    </div>
  );
}
