import type { Metadata } from "next";
import { ClipboardCheck, Building2, ShieldAlert } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { listPendingApprovals } from "@/features/expenses/queries";
import { ApprovalControls } from "@/features/expenses/components/approval-controls";
import { PageHeader } from "@/components/ui/page-header";
import { formatINR } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Approvals" };

const day = (d: Date): string => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/**
 * Approvals (architecture v2 · Super Admin / Manager). The cross-property queue of
 * expenses awaiting sign-off — large ones are flagged as needing Super-Admin
 * approval. Approving/rejecting reuses the audited expense-approval actions.
 */
export default async function ApprovalsPage() {
  const user = await requirePermission("expense:approve");
  const pending = await listPendingApprovals(user);

  return (
    <div className="mx-auto w-full max-w-3xl px-1 py-1">
      <PageHeader title="Approvals" description="Expenses awaiting your sign-off across your properties." />

      {pending.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed bg-muted/30 p-10 text-center">
          <ClipboardCheck className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">Nothing to approve</p>
          <p className="mt-1 text-sm text-muted-foreground">New expense approvals will appear here.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
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
      )}
    </div>
  );
}
