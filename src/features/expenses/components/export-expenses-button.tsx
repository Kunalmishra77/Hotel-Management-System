"use client";

/**
 * Instant CSV export of the currently-filtered expense ledger. The rows are already
 * computed server-side and handed to this button, so export is a client-side
 * serialise + download — no round-trip. Money formatted to rupees at the edge.
 */
import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EXPENSE_HEAD_LABEL, PAYMENT_MODE_LABEL } from "@/lib/constants/company";
import type { PortfolioExpenseRow } from "../queries";

const rupees = (p: number) => (p / 100).toFixed(2);
const csvCell = (v: string | number) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const d = (x: Date) => new Date(x).toISOString().slice(0, 10);

export function ExportExpensesButton({ rows }: { rows: PortfolioExpenseRow[] }) {
  const [done, setDone] = useState(false);

  const download = () => {
    const header = ["Date", "Property", "Category", "Sub-category", "Vendor", "Payment method", "Status", "Amount (INR)"];
    const body = rows.map((r) => [
      d(r.spentOn),
      r.propertyName,
      EXPENSE_HEAD_LABEL[r.head] ?? r.head,
      r.subCategory ?? "",
      r.vendor ?? "",
      r.paidVia ? (PAYMENT_MODE_LABEL[r.paidVia] ?? r.paidVia) : "",
      r.status,
      rupees(r.amountPaise),
    ]);
    const csv = [header, ...body].map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };

  return (
    <Button type="button" variant="outline" size="sm" onClick={download} disabled={rows.length === 0} data-testid="export-expenses-csv">
      <Download className="size-4" /> {done ? "Downloaded" : "Export CSV"}
    </Button>
  );
}
