"use client";

/**
 * The expense ledger under "All-property expenses" — hundreds of rows, so it is
 * searchable (item, vendor, property, category, GSTIN), filterable by status, and
 * shows 50 rows at a time ("Show 50 more") with the total of what matches. The
 * server-side filters above (property / category / payment / dates) still narrow
 * the set first; this narrows within it, instantly, with no reload.
 */
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn, formatDayMonth, formatINR } from "@/lib/utils";
import { EXPENSE_HEAD_LABEL, PAYMENT_MODE_LABEL } from "@/lib/constants/company";
import type { PortfolioExpenseRow } from "../queries";

const PAGE = 50;
const STATUSES = [
  { key: "ALL", label: "All" },
  { key: "APPROVED", label: "Approved" },
  { key: "DRAFT", label: "Pending" },
  { key: "REJECTED", label: "Rejected" },
] as const;
type StatusKey = (typeof STATUSES)[number]["key"];

const payLabel = (m: string | null) => (m ? (PAYMENT_MODE_LABEL[m as keyof typeof PAYMENT_MODE_LABEL] ?? m) : "—");
const headLabel = (h: string) => EXPENSE_HEAD_LABEL[h] ?? h;
const statusLabel = (s: string) => (s === "DRAFT" ? "Pending" : s === "APPROVED" ? "Approved" : s === "REJECTED" ? "Rejected" : s);

export function ExpenseLedger({ rows }: { rows: PortfolioExpenseRow[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusKey>("ALL");
  const [shown, setShown] = useState(PAGE);

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: rows.length };
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const matched = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "ALL" && r.status !== status) return false;
      if (!needle) return true;
      const hay = [r.description, r.subCategory, r.vendor, r.propertyName, headLabel(r.head), r.head, r.gstNumber, r.quantity, String(r.amountPaise / 100)]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, q, status]);
  const total = matched.reduce((s, r) => s + r.amountPaise, 0);
  const visible = matched.slice(0, shown);

  return (
    <div className="space-y-2" data-testid="expense-ledger">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setShown(PAGE); }}
          placeholder="Search item, vendor, property, category, amount…"
          className="h-10 min-w-0 flex-1 sm:max-w-sm"
          aria-label="Search expenses"
          data-testid="ledger-search"
        />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
          {STATUSES.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={status === s.key}
              onClick={() => { setStatus(s.key); setShown(PAGE); }}
              className={cn(
                "h-9 rounded-full border px-3 text-sm",
                status === s.key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
              data-testid={`ledger-status-${s.key}`}
            >
              {s.label} <span className="tabular-nums opacity-80">{counts[s.key] ?? 0}</span>
            </button>
          ))}
        </div>
        <p className="ml-auto text-sm text-muted-foreground" data-testid="ledger-summary">
          {matched.length} entr{matched.length === 1 ? "y" : "ies"} · <span className="font-semibold tabular text-foreground">{formatINR(total)}</span>
        </p>
      </div>

      <div className="max-h-[32rem] overflow-auto rounded-md border">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pl-3 pr-3 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 font-medium">Property</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Vendor</th>
              <th className="px-3 py-2 font-medium">Payment</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">No expenses match.</td></tr>
            ) : visible.map((r) => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="whitespace-nowrap py-2.5 pl-3 pr-3">{formatDayMonth(r.spentOn)}</td>
                <td className="px-3 py-2.5">
                  {r.description || r.subCategory || "—"}
                  {r.quantity ? <span className="text-muted-foreground"> · {r.quantity}</span> : null}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{r.propertyName}</td>
                <td className="px-3 py-2.5">{headLabel(r.head)}{r.subCategory && r.description ? <span className="text-muted-foreground"> · {r.subCategory}</span> : null}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{r.vendor ?? "—"}{r.hasBill ? " 📎" : ""}</td>
                <td className="px-3 py-2.5">{payLabel(r.paidVia)}</td>
                <td className="px-3 py-2.5">
                  <Badge variant={r.status === "APPROVED" ? "secondary" : r.status === "REJECTED" ? "destructive" : "outline"}>{statusLabel(r.status)}</Badge>
                </td>
                <td className="px-3 py-2.5 text-right font-medium tabular">{formatINR(r.amountPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {matched.length > shown ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setShown((n) => n + PAGE)} data-testid="ledger-more">
            Show {Math.min(PAGE, matched.length - shown)} more ({matched.length - shown} left)
          </Button>
        </div>
      ) : null}
    </div>
  );
}
