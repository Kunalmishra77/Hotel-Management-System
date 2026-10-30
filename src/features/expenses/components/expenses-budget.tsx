"use client";

/**
 * Budget vs actual (07 budget management) — approved spend per expense head for a
 * month, against the monthly budget where one is set.
 *
 * Reads at a glance even with NO budgets (the usual case): each head with spend
 * shows its amount and its share of the month, largest first; heads with nothing
 * spent collapse into one line. A budget turns the bar into "spent of budget"
 * (amber ≥ 80%, red over). Budgets are edited behind "Set budgets" when one
 * property is in focus (server upsert); in all-hotels scope the view is a
 * read-only aggregate. ← / → step through months (?bmonth=yyyy-mm).
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EXPENSE_HEAD_LABEL } from "@/lib/constants/company";
import { formatINR } from "@/lib/utils";
import { setExpenseBudget } from "../actions";
import type { BudgetVsActualRow } from "../queries";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string) => {
  const [y, mm] = m.split("-").map(Number);
  return `${MON[(mm ?? 1) - 1] ?? ""} ${y ?? ""}`;
};
const shiftMonth = (m: string, by: number) => {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y!, mm! - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const headLabel = (h: string) => EXPENSE_HEAD_LABEL[h] ?? h;

export function ExpensesBudget({
  rows,
  month,
  totalBudgetPaise,
  totalActualPaise,
  editablePropertyId,
}: {
  rows: BudgetVsActualRow[];
  month: string;
  totalBudgetPaise: number;
  totalActualPaise: number;
  editablePropertyId: string | null;
}) {
  const params = useSearchParams();
  const [editing, setEditing] = useState(false);
  const href = (m: string) => {
    const q = new URLSearchParams(params.toString());
    q.set("bmonth", m);
    return `?${q.toString()}#budget`;
  };
  const active = rows.filter((r) => r.actualPaise > 0 || r.budgetPaise > 0);
  const idle = rows.filter((r) => r.actualPaise === 0 && r.budgetPaise === 0);
  const overall = totalBudgetPaise > 0 ? Math.round((totalActualPaise / totalBudgetPaise) * 100) : 0;

  return (
    <Card className="mt-6" id="budget">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary"><Target /> Budget vs actual</CardTitle>
            <p className="text-sm text-muted-foreground">
              Approved spend {editablePropertyId ? "for this property" : "across all properties"} by category.
              {editablePropertyId ? "" : " Pick a property in the top bar to set its budgets."}
            </p>
          </div>
          <div className="flex items-center gap-1" aria-label="Month">
            <Button asChild variant="outline" size="icon" className="size-9"><Link href={href(shiftMonth(month, -1))} aria-label="Previous month" scroll={false}><ChevronLeft className="size-4" /></Link></Button>
            <span className="min-w-24 text-center text-sm font-medium" data-testid="budget-month">{monthLabel(month)}</span>
            <Button asChild variant="outline" size="icon" className="size-9"><Link href={href(shiftMonth(month, 1))} aria-label="Next month" scroll={false}><ChevronRight className="size-4" /></Link></Button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="text-sm text-muted-foreground">
            Spent <span className="text-lg font-semibold tabular text-foreground" data-testid="budget-total-spent">{formatINR(totalActualPaise)}</span>
          </p>
          {totalBudgetPaise > 0 ? (
            <p className={`text-sm ${totalActualPaise > totalBudgetPaise ? "text-destructive" : "text-muted-foreground"}`}>
              of budget {formatINR(totalBudgetPaise)} · {overall}%
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No budget set for {monthLabel(month)}</p>
          )}
          {editablePropertyId ? (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setEditing((v) => !v)} data-testid="budget-edit-toggle">
              {editing ? "Done" : "Set budgets"}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {active.length === 0 && !editing ? (
          <p className="rounded-md border p-4 text-center text-sm text-muted-foreground">No approved spend in {monthLabel(month)}.</p>
        ) : null}
        {(editing ? rows : active).map((r) => (
          <BudgetRow key={r.head} row={r} month={month} totalActualPaise={totalActualPaise} editablePropertyId={editing ? editablePropertyId : null} />
        ))}
        {!editing && idle.length > 0 ? (
          <p className="text-xs text-muted-foreground">Nothing spent: {idle.map((r) => headLabel(r.head)).join(", ")}.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function BudgetRow({
  row,
  month,
  totalActualPaise,
  editablePropertyId,
}: {
  row: BudgetVsActualRow;
  month: string;
  totalActualPaise: number;
  editablePropertyId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(row.budgetPaise > 0 ? String(Math.round(row.budgetPaise / 100)) : "");
  const [err, setErr] = useState<string | null>(null);

  const hasBudget = row.budgetPaise > 0;
  const pctOfBudget = hasBudget ? Math.round((row.actualPaise / row.budgetPaise) * 100) : 0;
  const share = totalActualPaise > 0 ? Math.round((row.actualPaise / totalActualPaise) * 100) : 0;
  const over = hasBudget && row.actualPaise > row.budgetPaise;
  // With a budget the bar is "spent of budget"; without one it is the head's share
  // of the month's spend, so the card still shows where the money went.
  const width = hasBudget ? Math.min(pctOfBudget, 100) : share;
  const barColor = !hasBudget ? "bg-primary/60" : over ? "bg-destructive" : pctOfBudget >= 80 ? "bg-amber-500" : "bg-primary";
  const dirty = editablePropertyId !== null && String(hasBudget ? Math.round(row.budgetPaise / 100) : "") !== value.trim();

  const save = () => {
    if (!editablePropertyId) return;
    const rupees = Number(value.trim() || "0");
    if (!Number.isFinite(rupees) || rupees < 0) { setErr("Enter a valid amount"); return; }
    setErr(null);
    start(async () => {
      const res = await setExpenseBudget({ propertyId: editablePropertyId, head: row.head as never, month, amountPaise: Math.round(rupees * 100) });
      if (res.ok) router.refresh();
      else setErr(res.error?.message ?? "Failed");
    });
  };

  return (
    <div data-testid={`budget-row-${row.head}`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 text-sm">
        <span className="font-medium">{headLabel(row.head)}</span>
        <span className="flex items-center gap-2">
          <span className={`tabular ${over ? "font-semibold text-destructive" : ""}`}>{formatINR(row.actualPaise)}</span>
          <span className="text-xs text-muted-foreground">
            {hasBudget ? `of ${formatINR(row.budgetPaise)} · ${pctOfBudget}%` : `${share}% of the month`}
          </span>
          {over ? <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">Over budget</span> : null}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="presentation">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${width}%` }} />
      </div>
      {editablePropertyId ? (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Monthly budget ₹</span>
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Not set"
            className="h-8 w-32 text-sm"
            aria-label={`${headLabel(row.head)} monthly budget`}
            data-testid={`budget-input-${row.head}`}
          />
          {dirty ? (
            <Button size="sm" className="h-8" disabled={pending} onClick={save} data-testid={`budget-save-${row.head}`}>{pending ? "…" : "Save"}</Button>
          ) : null}
          {err ? <span className="text-xs text-destructive">{err}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
