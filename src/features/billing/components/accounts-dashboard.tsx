import Link from "next/link";
import {
  ReceiptText, Wallet, ChartColumn, ClipboardCheck, RefreshCw, FileText, IndianRupee,
  CircleDollarSign, FolderOpen, TrendingUp, ArrowRight, Inbox,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { TrendChart } from "@/components/ui/charts/trend-chart";
import type { BillingOverview } from "../queries";
import type { PendingApproval } from "@/features/expenses/queries";

const inr = (p: number) => `₹${Math.round(p / 100).toLocaleString("en-IN")}`;

/**
 * Accounts command centre — the finance desk's home: receivables, collections,
 * invoicing and sign-offs. Distinct from Reception (operational) and Manager
 * (portfolio monitoring). Branched by resolvePortal() === ACCOUNTS.
 */
export function AccountsDashboard({
  name,
  billing,
  revenueTrend,
  approvals,
  revenueTodayPaise,
  canApprove,
}: {
  name: string;
  billing: BillingOverview;
  revenueTrend: { label: string; value: number }[];
  approvals: PendingApproval[];
  revenueTodayPaise: number | null;
  canApprove: boolean;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={`Accounts — welcome, ${name}`} description="Receivables, collections, invoicing & sign-offs" />

      {/* Finance actions */}
      <div className="flex flex-wrap gap-2">
        <Button asChild size="lg"><Link href="/billing"><ReceiptText /><span className="ml-1.5">Billing</span></Link></Button>
        <Button asChild size="lg" variant="outline"><Link href="/expenses"><Wallet /><span className="ml-1.5">Expenses</span></Link></Button>
        <Button asChild size="lg" variant="outline"><Link href="/reports"><ChartColumn /><span className="ml-1.5">Reports</span></Link></Button>
        {canApprove ? <Button asChild size="lg" variant="outline"><Link href="/approvals"><ClipboardCheck /><span className="ml-1.5">Approvals</span></Link></Button> : null}
        <Button asChild size="lg" variant="outline"><Link href="/accounting"><RefreshCw /><span className="ml-1.5">Accounting</span></Link></Button>
      </div>

      {/* Finance KPI band */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Outstanding" value={inr(billing.outstandingPaise)} icon={<CircleDollarSign />} hint="Receivables" href="/billing" className={billing.outstandingPaise > 0 ? "border-warning/40" : undefined} />
        <KpiCard label="Collected today" value={inr(billing.collectedTodayPaise)} icon={<IndianRupee />} hint="Payments in" href="/billing" />
        <KpiCard label="Unsettled folios" value={billing.unsettledFolios} icon={<FolderOpen />} hint="Open balances" href="/billing" />
        <KpiCard label="Invoices this month" value={billing.invoicesThisMonth} icon={<FileText />} hint="Issued" href="/billing" />
        <KpiCard label="Revenue today" value={revenueTodayPaise === null ? "—" : inr(revenueTodayPaise)} icon={<TrendingUp />} hint="Gross" href="/reports" />
        <KpiCard label="Pending approvals" value={approvals.length} icon={<ClipboardCheck />} hint="Awaiting sign-off" href="/approvals" className={approvals.length > 0 ? "border-warning/40" : undefined} />
      </div>

      {/* Revenue trend + approvals */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base">Revenue — last 14 days</CardTitle>
            <Link href="/reports" className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">Reports <ArrowRight className="size-3.5" aria-hidden="true" /></Link>
          </CardHeader>
          <CardContent>
            {revenueTrend.length > 0 ? (
              <TrendChart data={revenueTrend} format="inr" height={200} />
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">No revenue in range yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary"><ClipboardCheck /> To approve</CardTitle>
            {approvals.length > 0 ? <Link href="/approvals" className="text-sm font-medium text-primary underline-offset-4 hover:underline">All</Link> : null}
          </CardHeader>
          <CardContent className="pt-0">
            {approvals.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Inbox className="mx-auto size-5" aria-hidden="true" />
                <p className="mt-2">Nothing awaiting sign-off.</p>
              </div>
            ) : (
              <ul className="divide-y">
                {approvals.slice(0, 6).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{a.vendor ?? a.head}</div>
                      <div className="text-xs text-muted-foreground">{a.head}</div>
                    </div>
                    <span className="shrink-0 tabular font-semibold">{inr(a.amountPaise)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
