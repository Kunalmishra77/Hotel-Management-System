"use client";

/**
 * Budget vs actual (07 budget management) — per expense head for a month. Shows a
 * progress bar of approved spend against its budget, over-budget in red. When a
 * single property is in focus, each head is editable inline (set the monthly budget
 * in ₹ → server upsert). In all-hotels scope it's a read-only aggregate across the
 * portfolio, with a hint to pick a property to set targets. Money shown in ₹.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EXPENSE_HEAD_LABEL } from "@/lib/constants/company";
import { formatINR } from "@/lib/utils";
import { setExpenseBudget } from "../actions";
import type { BudgetVsActualRow } from "../queries";

const monthLabel = (m: string) => {
  const [y, mm] = m.split("-").map(Number);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${MON[(mm ?? 1) - 1] ?? ""} ${y ?? ""}`;
};

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
  const overall = totalBudgetPaise > 0 ? Math.round((totalActualPaise / totalBudgetPaise) * 100) : 0;
  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary"><Target /> Budget vs actual · {monthLabel(month)}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {editablePropertyId
                ? "Approved spend against this property's monthly budget. Set a target per category below."
                : "Approved spend against budget across all properties. Pick a property from the top bar to set targets."}
            </p>
          </div>
          {totalBudgetPaise > 0 ? (
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Overall</p>
              <p className={`tabular text-lg font-semibold ${totalActualPaise > totalBudgetPaise ? "text-destructive" : "text-foreground"}`}>{formatINR(totalActualPaise)} <span className="text-sm font-normal text-muted-foreground">/ {formatINR(totalBudgetPaise)} · {overall}%</span></p>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((r) => (
          <BudgetRow key={r.head} row={r} month={month} editablePropertyId={editablePropertyId} />
        ))}
      </CardContent>
    </Card>
  );
}

function BudgetRow({ row, month, editablePropertyId }: { row: BudgetVsActualRow; month: string; editablePropertyId: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(row.budgetPaise > 0 ? String(Math.round(row.budgetPaise / 100)) : "");
  const [err, setErr] = useState<string | null>(null);

  const label = EXPENSE_HEAD_LABEL[row.head] ?? row.head;
  const pct = row.budgetPaise > 0 ? Math.round((row.actualPaise / row.budgetPaise) * 100) : 0;
  const over = row.budgetPaise > 0 && row.actualPaise > row.budgetPaise;
  const barColor = over ? "bg-destructive" : pct >= 80 ? "bg-amber-500" : "bg-primary";
  const dirty = editablePropertyId !== null && String(row.budgetPaise > 0 ? Math.round(row.budgetPaise / 100) : "") !== value.trim();

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
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="flex items-center gap-2">
          <span className={`tabular ${over ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
            {formatINR(row.actualPaise)}{row.budgetPaise > 0 ? <> / {formatINR(row.budgetPaise)} · {pct}%</> : row.actualPaise > 0 ? " spent" : ""}
          </span>
          {over ? <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">Over budget</span> : null}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      {editablePropertyId ? (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Budget ₹</span>
          <Input
            type="number"
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Not set"
            className="h-8 w-32 text-sm"
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
