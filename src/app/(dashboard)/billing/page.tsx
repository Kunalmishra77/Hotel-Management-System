import type { Metadata } from "next";
import { ReceiptText, Wallet } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { outstanding, searchInvoices } from "@/features/billing/queries";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Billing" };

const fmtDate = (d: Date) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

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

  const [duePaise, { invoices }] = await Promise.all([
    outstanding(user, propertyId),
    searchInvoices(user, { propertyId, limit: 25 }),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader title="Billing" description="Outstanding dues and GST tax invoices for this property." />

      <div className="grid grid-cols-2 gap-3" data-testid="billing-kpis">
        <KpiCard
          label="Outstanding dues"
          value={formatINR(duePaise)}
          icon={<Wallet />}
          hint="Unsettled folio balances"
          trend={duePaise > 0 ? "down" : "up"}
        />
        <KpiCard label="Recent invoices" value={String(invoices.length)} icon={<ReceiptText />} hint="Latest issued" />
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">GST invoices</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {invoices.length === 0 ? (
            <div className="px-4 pb-2">
              <EmptyState
                icon={<ReceiptText />}
                title="No invoices yet"
                description="A GST tax invoice is issued from a guest's folio at settlement."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="invoice-list">
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Issued</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-sm font-medium">{inv.number}</TableCell>
                      <TableCell>{inv.customerName}</TableCell>
                      <TableCell className="text-right tabular font-medium">{formatINR(inv.totalPaise)}</TableCell>
                      <TableCell className="text-right tabular text-muted-foreground">{fmtDate(inv.issuedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
