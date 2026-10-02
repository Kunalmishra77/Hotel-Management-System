"use client";

/**
 * Detailed expense report export (client req) — a structured CSV an accountant can
 * use directly. GST bills (input-credit claimable) are listed separately from
 * non-GST spend; within each section rows are grouped by date with per-day and
 * per-section subtotals, and every detail column is included (head, sub-category,
 * description, quantity, vendor, GSTIN, payment, status, amount). Opens in Excel.
 * Rows are already server-filtered (property / date-range) so the export matches
 * exactly what's on screen — the month filter drives a one-month report.
 */
import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EXPENSE_HEAD_LABEL, PAYMENT_MODE_LABEL } from "@/lib/constants/company";
import type { PortfolioExpenseRow } from "../queries";

const rupees = (p: number) => (p / 100).toFixed(2);
const d = (x: Date) => new Date(x).toISOString().slice(0, 10);
const csvCell = (v: string | number) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const COLUMNS = [
  "Date", "Section", "Property", "Head", "Sub-category", "Description",
  "Quantity", "Vendor", "GSTIN", "Payment method", "Status", "Amount (INR)",
] as const;
const COLS = COLUMNS.length;

/** A full-width row with a label in the first cell and the amount in the last. */
function totalRow(label: string, paise: number): string[] {
  const row = Array<string>(COLS).fill("");
  row[0] = label;
  row[COLS - 1] = rupees(paise);
  return row;
}

function sectionRows(
  rows: PortfolioExpenseRow[],
  sectionLabel: string,
): { lines: string[][]; total: number } {
  const lines: string[][] = [];
  if (rows.length === 0) return { lines, total: 0 };
  // Group by date (ascending) so the report reads day-by-day.
  const byDate = new Map<string, PortfolioExpenseRow[]>();
  for (const r of [...rows].sort((a, b) => +new Date(a.spentOn) - +new Date(b.spentOn))) {
    const key = d(r.spentOn);
    (byDate.get(key) ?? byDate.set(key, []).get(key)!).push(r);
  }
  let total = 0;
  for (const [date, dayRows] of byDate) {
    let dayTotal = 0;
    for (const r of dayRows) {
      dayTotal += r.amountPaise;
      lines.push([
        date,
        sectionLabel,
        r.propertyName,
        EXPENSE_HEAD_LABEL[r.head] ?? r.head,
        r.subCategory ?? "",
        r.description ?? "",
        r.quantity ?? "",
        r.vendor ?? "",
        r.gstNumber ?? "",
        r.paidVia ? (PAYMENT_MODE_LABEL[r.paidVia] ?? r.paidVia) : "",
        r.status,
        rupees(r.amountPaise),
      ]);
    }
    lines.push(totalRow(`  Subtotal ${date} (${dayRows.length} item${dayRows.length > 1 ? "s" : ""})`, dayTotal));
    total += dayTotal;
  }
  return { lines, total };
}

export function ExportExpensesButton({ rows }: { rows: PortfolioExpenseRow[] }) {
  const [done, setDone] = useState(false);

  const download = () => {
    const gst = rows.filter((r) => r.head === "GST_BILLS");
    const nonGst = rows.filter((r) => r.head !== "GST_BILLS");
    const dates = rows.map((r) => d(r.spentOn)).sort();
    const period = dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : "—";

    const gstSec = sectionRows(gst, "GST bill");
    const otherSec = sectionRows(nonGst, "Non-GST");

    const out: string[][] = [];
    out.push(["Expenses Report"]);
    out.push([`Period: ${period}`]);
    out.push([`Generated: ${new Date().toISOString().slice(0, 10)}`]);
    out.push([]);
    out.push(["=== GST BILLS (input-credit claimable) ==="]);
    out.push([...COLUMNS]);
    if (gstSec.lines.length) out.push(...gstSec.lines);
    else out.push(["(none)"]);
    out.push(totalRow("GST bills — section total", gstSec.total));
    out.push([]);
    out.push(["=== NON-GST EXPENSES ==="]);
    out.push([...COLUMNS]);
    if (otherSec.lines.length) out.push(...otherSec.lines);
    else out.push(["(none)"]);
    out.push(totalRow("Non-GST — section total", otherSec.total));
    out.push([]);
    out.push(totalRow("GRAND TOTAL", gstSec.total + otherSec.total));

    const csv = out.map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };

  return (
    <Button type="button" variant="outline" size="sm" onClick={download} disabled={rows.length === 0} data-testid="export-expenses-csv">
      <Download className="size-4" /> {done ? "Downloaded" : "Export report"}
    </Button>
  );
}
