"use client";

/**
 * The approval queue, pinned to the TOP of the Expenses page (client: "approval
 * wale upar rahein, jisse approve karne wale ko asani se dikhe"). Every expense
 * still waiting, across the properties in view, oldest first — with approve /
 * reject per line and "Approve all". Only approved spend counts in reports, so
 * the queue says so. Rendered for approvers only; the server re-checks each act.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { approveExpense, rejectExpense } from "../actions";
import { EXPENSE_HEAD_LABEL, type ExpenseHeadKey } from "../subcategories";
import type { PendingExpense } from "../queries";

const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;
const day = (d: Date) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

export function PendingApprovals({ items }: { items: PendingExpense[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  if (items.length === 0) return null;
  const total = items.reduce((s, e) => s + e.amountPaise, 0);

  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error?.message ?? "Couldn't update the expense.");
      router.refresh();
    });
  };
  const approveAll = () =>
    run(async () => {
      for (const e of items) {
        const r = await approveExpense({ expenseId: e.id });
        if (!r.ok) return r;
      }
      return { ok: true };
    });

  return (
    <section className="rounded-lg border border-amber-500/50 bg-amber-500/5" aria-labelledby="pending-approvals-title" data-testid="pending-approvals">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 px-4 py-3">
        <div>
          <h2 id="pending-approvals-title" className="font-semibold">
            Waiting for approval · {items.length} · {rupees(total)}
          </h2>
          <p className="text-xs text-muted-foreground">Not counted in reports or profit until approved.</p>
        </div>
        {items.length > 1 && (
          <Button size="sm" disabled={pending} onClick={approveAll} data-testid="approve-all-pending">
            Approve all ({items.length})
          </Button>
        )}
      </div>
      {error && <p role="alert" className="px-4 pt-2 text-sm text-destructive">{error}</p>}
      <ul className="max-h-80 divide-y overflow-y-auto text-sm">
        {items.map((e) => (
          <li key={e.id} className="space-y-2 px-4 py-2" data-testid={`pending-${e.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {e.description || e.subCategory || EXPENSE_HEAD_LABEL[e.head as ExpenseHeadKey] || e.head}
                  {e.quantity ? <span className="font-normal text-muted-foreground"> · {e.quantity}</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {day(e.spentOn)} · {e.propertyName} · {EXPENSE_HEAD_LABEL[e.head as ExpenseHeadKey] ?? e.head}
                  {e.vendor ? ` · ${e.vendor}` : ""}{e.hasBill ? " · 📎" : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="font-medium tabular-nums">{rupees(e.amountPaise)}</span>
                <Button size="sm" disabled={pending} onClick={() => run(() => approveExpense({ expenseId: e.id }))} data-testid={`pending-approve-${e.id}`}>
                  Approve
                </Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => { setRejecting(rejecting === e.id ? null : e.id); setReason(""); }}>
                  Reject
                </Button>
              </div>
            </div>
            {rejecting === e.id && (
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(ev) => { ev.preventDefault(); if (reason.trim()) { setRejecting(null); run(() => rejectExpense({ expenseId: e.id, reason: reason.trim() })); } }}
              >
                <input
                  value={reason}
                  onChange={(ev) => setReason(ev.target.value)}
                  placeholder="Why? e.g. entered twice"
                  className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                  aria-label="Reason for rejecting"
                  autoFocus
                />
                <Button type="submit" size="sm" variant="destructive" disabled={!reason.trim() || pending}>Reject expense</Button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
