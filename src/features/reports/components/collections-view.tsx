"use client";

/**
 * Daily collections (cash book) — every payment and refund received in the
 * period: totals per mode, a day × mode grid for the evening cash match, and the
 * full list with who received each payment.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { formatINR } from "@/lib/utils";
import { PAYMENT_MODE_LABEL } from "@/lib/constants/company";
import type { CollectionEntry } from "../register-queries";
import { ExportTableButton } from "./export-table-button";
import type { ReportColumn, ReportRow } from "./report-table";

const modeLabel = (m: string) => PAYMENT_MODE_LABEL[m] ?? m.replace(/_/g, " ").toLowerCase();
const dayLabel = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const time = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export function CollectionsView({ rows, propertyNames, filename }: { rows: CollectionEntry[]; propertyNames: Record<string, string>; filename: string }) {
  const [mode, setMode] = useState("");
  const modes = useMemo(() => [...new Set(rows.map((r) => r.mode))].sort(), [rows]);
  const shown = mode ? rows.filter((r) => r.mode === mode) : rows;
  const byMode = new Map<string, number>();
  for (const r of rows) byMode.set(r.mode, (byMode.get(r.mode) ?? 0) + r.amountPaise);
  const days = [...new Set(rows.map((r) => r.day))].sort();
  const cell = new Map<string, number>();
  for (const r of rows) cell.set(`${r.day}|${r.mode}`, (cell.get(`${r.day}|${r.mode}`) ?? 0) + r.amountPaise);
  const total = rows.reduce((n, r) => n + r.amountPaise, 0);
  const refunds = rows.filter((r) => r.amountPaise < 0).reduce((n, r) => n + r.amountPaise, 0);

  const columns: ReportColumn[] = [
    { key: "at", label: "Received" }, { key: "property", label: "Hotel" }, { key: "for", label: "For" }, { key: "mode", label: "Mode" },
    { key: "amount", label: "Amount", format: "money" }, { key: "by", label: "Received by" }, { key: "ref", label: "Reference" },
  ];
  const csv: ReportRow[] = shown.map((r) => ({ at: time(r.at), property: propertyNames[r.propertyId] ?? "", for: r.forLabel, mode: modeLabel(r.mode), amount: r.amountPaise, by: r.receivedBy, ref: r.reference ?? "" }));

  if (rows.length === 0) return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No payments received in this period.</p>;
  return (
    <section className="space-y-4" data-testid="collections">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Total collected</p>
          <p className="text-lg font-semibold tabular-nums">{formatINR(total)}</p>
          <p className="text-xs text-muted-foreground">{refunds ? `after ${formatINR(-refunds)} refunds` : `${rows.length} payments`}</p>
        </div>
        {[...byMode.entries()].sort((a, b) => b[1] - a[1]).map(([m, v]) => (
          <div key={m} className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">{modeLabel(m)}</p>
            <p className="text-lg font-semibold tabular-nums">{formatINR(v)}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Day by day</h3>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Day</th>
              {modes.map((m) => <th key={m} className="px-3 py-2 text-right font-medium">{modeLabel(m)}</th>)}
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr></thead>
            <tbody>
              {days.map((d) => (
                <tr key={d} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{dayLabel(d)}</td>
                  {modes.map((m) => <td key={m} className="px-3 py-2 text-right tabular-nums text-muted-foreground">{cell.get(`${d}|${m}`) ? formatINR(cell.get(`${d}|${m}`)!) : "—"}</td>)}
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{formatINR(modes.reduce((n, m) => n + (cell.get(`${d}|${m}`) ?? 0), 0))}</td>
                </tr>
              ))}
              <tr className="border-t-2 bg-muted/30 font-semibold">
                <td className="px-3 py-2">Total</td>
                {modes.map((m) => <td key={m} className="px-3 py-2 text-right tabular-nums">{formatINR(byMode.get(m) ?? 0)}</td>)}
                <td className="px-3 py-2 text-right tabular-nums">{formatINR(total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Every payment</h3>
          <div className="flex items-center gap-2">
            <select className="h-11 rounded-md border bg-background px-3 text-sm" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Payment mode">
              <option value="">All modes</option>
              {modes.map((m) => <option key={m} value={m}>{modeLabel(m)}</option>)}
            </select>
            <ExportTableButton filename={filename} columns={columns} rows={csv} totalsRow={{ at: "Total", amount: shown.reduce((n, r) => n + r.amountPaise, 0) }} />
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              {["Received", "For", "Hotel", "Mode", "Amount", "Received by"].map((h) => <th key={h} className={`px-3 py-2 font-medium ${h === "Amount" ? "text-right" : ""}`}>{h}</th>)}
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{time(r.at)}</td>
                  <td className="px-3 py-2">{r.reservationId ? <Link href={`/bookings/${r.reservationId}`} className="text-primary underline-offset-2 hover:underline">{r.forLabel}</Link> : r.forLabel}
                    {r.reference ? <span className="block text-xs text-muted-foreground">{r.reference}</span> : null}</td>
                  <td className="px-3 py-2 text-muted-foreground">{propertyNames[r.propertyId] ?? ""}</td>
                  <td className="px-3 py-2 text-muted-foreground">{modeLabel(r.mode)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.amountPaise < 0 ? "text-destructive" : ""}`}>{formatINR(r.amountPaise)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.receivedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
