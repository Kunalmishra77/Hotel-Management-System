"use client";

/**
 * Instant CSV export of the profit report currently on screen (Phase-3 ⑪). The
 * report figures are already computed server-side and handed to this button, so
 * export is a client-side serialise + download — no export job, no round-trip.
 * Money is formatted to rupees at the edge (reporting.md: paise internally, ₹ out).
 */
import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProfitReport, RevenueSegments } from "../queries";

const rupees = (p: number) => (p / 100).toFixed(2);
const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function ExportReportButton({
  month,
  scopeLabel,
  report,
  segments,
}: {
  month: string;
  scopeLabel: string;
  report: ProfitReport;
  segments: RevenueSegments;
}) {
  const [done, setDone] = useState(false);
  const b = report.breakdown;

  const build = (): string => {
    const rows: (string | number)[][] = [];
    rows.push(["Woodpecker — Profit report"]);
    rows.push(["Period", month]);
    rows.push(["Scope", scopeLabel]);
    rows.push([]);
    rows.push(["Section", "Line", "Amount (INR)"]);
    rows.push(["Revenue", "Total", rupees(b.revenuePaise)]);
    for (const [cat, v] of Object.entries(b.revenueByCategory)) if (v !== 0) rows.push(["Revenue", cat, rupees(v)]);
    rows.push(["Expenses", "Total", rupees(b.expensePaise)]);
    for (const [head, v] of Object.entries(b.expenseByHead)) rows.push(["Expenses", head, rupees(v)]);
    rows.push(["Expenses", "Staff (payroll)", rupees(b.staffCostPaise)]);
    rows.push(["Profit", "Total", rupees(b.profitPaise)]);
    rows.push([]);
    rows.push(["Metrics", "Occupancy %", (report.metrics.occupancyBps / 100).toFixed(1)]);
    rows.push(["Metrics", "ADR (INR)", rupees(report.metrics.adrPaise)]);
    rows.push(["Metrics", "RevPAR (INR)", rupees(report.metrics.revparPaise)]);
    rows.push([]);
    rows.push(["Revenue by source", "Source", "Amount (INR)"]);
    for (const s of segments.bySource) rows.push(["", s.source, rupees(s.revenuePaise)]);
    if (segments.corporates.length > 0) {
      rows.push([]);
      rows.push(["Top corporate clients", "Client", "Amount (INR)"]);
      for (const c of segments.corporates.slice(0, 20)) rows.push(["", c.name, rupees(c.revenuePaise)]);
    }
    return rows.map((r) => r.map(csvCell).join(",")).join("\n");
  };

  const download = () => {
    const blob = new Blob([build()], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `profit-report-${month}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };

  return (
    <Button type="button" variant="outline" size="sm" onClick={download} data-testid="export-report-csv">
      <Download className="size-4" /> {done ? "Downloaded" : "Export CSV"}
    </Button>
  );
}
