import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck, Building2, ShieldAlert, Wrench, ArrowRight } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/permissions";
import { listPendingApprovals } from "@/features/expenses/queries";
import { listMaintenanceCostReview } from "@/features/maintenance/queries";
import { ApprovalControls } from "@/features/expenses/components/approval-controls";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Approvals" };

const day = (d: Date): string => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/**
 * Approvals (architecture v2 · Super Admin / Manager). The cross-property queue of
 * things awaiting sign-off — expenses (approve/reject inline) plus high-value
 * maintenance spend to review. Large expenses are flagged for Super-Admin approval.
 */
export default async function ApprovalsPage() {
  const user = await requirePermission("expense:approve");
  const [pending, maintCosts] = await Promise.all([
    listPendingApprovals(user),
    hasPermission(user, "maintenance:manage") ? listMaintenanceCostReview(user) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl px-1 py-1">
      <PageHeader title="Approvals" description="Expenses and high-value spend awaiting your sign-off." />

      {pending.length === 0 && maintCosts.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed bg-muted/30 p-10 text-center">
          <ClipboardCheck className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">Nothing to approve</p>
          <p className="mt-1 text-sm text-muted-foreground">New approvals will appear here.</p>
        </div>
      ) : null}

      {pending.length > 0 && (
        <>
        <h2 className="mt-6 mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Expense approvals</h2>
        <ul className="space-y-3">
          {pending.map((e) => (
            <li key={e.id} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{e.head}{e.subCategory ? ` · ${e.subCategory}` : ""}</span>
                    {e.needsSuperApproval ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                        <ShieldAlert className="size-3" aria-hidden="true" /> Super-admin approval
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Building2 className="size-3.5" aria-hidden="true" /> {e.propertyName} · {day(e.spentOn)}
                    {e.vendor ? ` · ${e.vendor}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-lg font-semibold tabular">{formatINR(e.amountPaise)}</span>
              </div>
              <div className="mt-3 border-t pt-3">
                <ApprovalControls expenseId={e.id} />
              </div>
            </li>
          ))}
        </ul>
        </>
      )}

      {maintCosts.length > 0 && (
        <Card className="mt-6">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="size-4 text-primary" aria-hidden="true" /> Maintenance spend to review
              <span className="text-sm font-normal text-muted-foreground">· {maintCosts.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5">
              {maintCosts.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{m.category}</span>
                    <span className="ml-2 text-muted-foreground">{m.description}</span>
                    <span className="ml-2 text-xs text-muted-foreground">· {m.propertyName}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular">{formatINR(m.costPaise)}</span>
                </li>
              ))}
              <li className="pt-1">
                <Link href="/maintenance" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  Open maintenance <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </li>
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
