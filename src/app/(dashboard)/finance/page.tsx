import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck, IndianRupee, Receipt, Wallet, Banknote, ArrowRight, ShieldAlert } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/permissions";
import { liveTiles } from "@/features/analytics/queries";
import { listPendingApprovals } from "@/features/expenses/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { formatINR } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Finance & approvals" };

/**
 * Manager · Finance & Approvals (architecture v2 · consolidation). One place for
 * the money the manager owns: pending expense approvals, today's revenue/expenses/
 * dues, and shortcuts into billing, expenses, and payroll. `report:view-financial`.
 */
export default async function FinancePage() {
  const user = await requirePermission("report:view-financial");
  const propertyId = user.activePropertyId ?? user.accessiblePropertyIds[0] ?? null;

  const [tiles, approvals] = await Promise.all([
    propertyId ? liveTiles(user, [propertyId]) : Promise.resolve(null),
    hasPermission(user, "expense:approve") ? listPendingApprovals(user) : Promise.resolve([]),
  ]);
  const here = propertyId ? approvals.filter((a) => a.propertyId === propertyId) : [];

  const links = [
    { href: "/billing", label: "Billing & folios", icon: <Receipt className="size-4" /> },
    { href: "/expenses", label: "Expenses", icon: <Wallet className="size-4" /> },
    { href: "/payroll", label: "Payroll", icon: <Banknote className="size-4" /> },
    { href: "/approvals", label: "All approvals", icon: <ClipboardCheck className="size-4" /> },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl px-1 py-1">
      <PageHeader title="Finance & approvals" description="The money you own — approvals, today's numbers, and the books." />

      {tiles && (tiles.revenueTodayPaise !== null) && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <KpiCard label="Revenue today" value={formatINR(tiles.revenueTodayPaise)} icon={<IndianRupee />} />
          <KpiCard label="Expenses today" value={formatINR(tiles.expenseTodayPaise ?? 0)} icon={<Receipt />} />
          <KpiCard label="Pending dues" value={formatINR(tiles.pendingPaise ?? 0)} icon={<Wallet />} hint="Unsettled folios" />
        </div>
      )}

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="size-4 text-primary" aria-hidden="true" /> Pending approvals
            <span className="text-sm font-normal text-muted-foreground">· {here.length}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {here.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing awaiting your approval.</p>
          ) : (
            <ul className="space-y-2">
              {here.slice(0, 5).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{a.head}{a.subCategory ? ` · ${a.subCategory}` : ""}</span>
                    {a.needsSuperApproval ? <ShieldAlert className="size-3.5 shrink-0 text-amber-600" aria-hidden="true" /> : null}
                  </span>
                  <span className="shrink-0 font-semibold tabular">{formatINR(a.amountPaise)}</span>
                </li>
              ))}
              <li className="pt-1">
                <Link href="/approvals" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  Review all approvals <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </li>
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="group flex items-center justify-between rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md">
            <span className="inline-flex items-center gap-2 font-medium">{l.icon} {l.label}</span>
            <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
          </Link>
        ))}
      </div>
    </div>
  );
}
