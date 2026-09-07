import Link from "next/link";
import { Wallet, ReceiptText, HandCoins, FileText } from "lucide-react";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { formatINR } from "@/lib/utils";
import type { PortfolioBilling as PortfolioBillingData } from "../queries";

/** Super-Admin portfolio billing — consolidated dues/collections + a per-property
 *  breakdown. Figures reuse each property's canonical billingOverview. */
export function PortfolioBilling({ rollup }: { rollup: PortfolioBillingData }) {
  const t = rollup.totals;
  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title="Billing" description="Consolidated dues, collections and invoices across every property." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Outstanding dues" value={formatINR(t.outstandingPaise)} icon={<Wallet />} hint="Portfolio-wide" trend={t.outstandingPaise > 0 ? "down" : "up"} />
        <KpiCard label="Unsettled folios" value={String(t.unsettledFolios)} icon={<ReceiptText />} hint="With a balance" />
        <KpiCard label="Collected today" value={formatINR(t.collectedTodayPaise)} icon={<HandCoins />} hint="Payments received" />
        <KpiCard label="Invoices this month" value={String(t.invoicesThisMonth)} icon={<FileText />} hint="GST invoices issued" />
      </div>

      <Card className="mt-6">
        <CardHeader className="pb-2"><CardTitle className="text-base">By property</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Property</th>
                  <th className="py-2 px-3 text-right font-medium">Outstanding</th>
                  <th className="py-2 px-3 text-right font-medium">Unsettled</th>
                  <th className="py-2 px-3 text-right font-medium">Collected today</th>
                  <th className="py-2 pl-3 text-right font-medium">Invoices (mo.)</th>
                </tr>
              </thead>
              <tbody>
                {rollup.rows.length === 0 ? (
                  <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No properties.</td></tr>
                ) : (
                  rollup.rows.map((r) => (
                    <tr key={r.propertyId} className="border-b last:border-0">
                      <td className="py-2.5 pr-3 font-medium">{r.name}</td>
                      <td className={`py-2.5 px-3 text-right tabular ${r.outstandingPaise > 0 ? "text-amber-700 dark:text-amber-400 font-semibold" : ""}`}>{formatINR(r.outstandingPaise)}</td>
                      <td className="py-2.5 px-3 text-right tabular text-muted-foreground">{r.unsettledFolios}</td>
                      <td className="py-2.5 px-3 text-right tabular text-muted-foreground">{formatINR(r.collectedTodayPaise)}</td>
                      <td className="py-2.5 pl-3 text-right tabular text-muted-foreground">{r.invoicesThisMonth}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Open a property to see its folios and issue invoices. <Link href="/overview" className="underline underline-offset-4">Portfolio overview →</Link></p>
        </CardContent>
      </Card>
    </div>
  );
}
