"use client";

/**
 * Instant CSV export for any report table (same columns/rows the ReportTable shows).
 * Client-side serialise + download; money → rupees, percent → number, at the edge.
 */
import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReportColumn, ReportRow } from "./report-table";

const csvCell = (v: string | number) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function cell(v: string | number | undefined, format?: ReportColumn["format"]): string {
  if (v === undefined || v === null || v === "") return "";
  if (format === "money") return (Number(v) / 100).toFixed(2);
  if (format === "percent") return String(Math.round(Number(v)));
  return String(v);
}

export function ExportTableButton({
  filename,
  columns,
  rows,
  totalsRow,
}: {
  filename: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  totalsRow?: ReportRow;
}) {
  const [done, setDone] = useState(false);
  const download = () => {
    const header = columns.map((c) => c.label + (c.format === "money" ? " (INR)" : c.format === "percent" ? " (%)" : ""));
    const body = [...rows, ...(totalsRow ? [totalsRow] : [])].map((r) => columns.map((c) => cell(r[c.key], c.format)));
    const csv = [header, ...body].map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };
  return (
    <Button type="button" variant="outline" size="sm" onClick={download} disabled={rows.length === 0} data-testid="export-report-table">
      <Download className="size-4" /> {done ? "Downloaded" : "Export CSV"}
    </Button>
  );
}
