"use client";

/**
 * Booking register (Reports → Bookings): every booking of the period with its
 * money, searchable and filterable, each row opening the booking. The summary
 * and the CSV follow the filters, so "last month's MMT bookings with dues" is two
 * taps and one download.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { formatINR } from "@/lib/utils";
import { BOOKING_SOURCE_LABEL } from "@/lib/constants/company";
import type { BookingRegisterEntry } from "../register-queries";
import { ExportTableButton } from "./export-table-button";
import type { ReportColumn, ReportRow } from "./report-table";

const STATUS_LABEL: Record<string, string> = {
  ENQUIRY: "Enquiry", CONFIRMED: "Confirmed", IN_HOUSE: "In-house", CHECKED_OUT: "Checked out", CANCELLED: "Cancelled", NO_SHOW: "No-show",
};
const src = (s: string) => BOOKING_SOURCE_LABEL[s] ?? s.replace(/_/g, " ").toLowerCase();
const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

const COLUMNS: ReportColumn[] = [
  { key: "code", label: "Booking" }, { key: "guest", label: "Guest" }, { key: "company", label: "Company" }, { key: "property", label: "Hotel" },
  { key: "rooms", label: "Room" }, { key: "source", label: "Source" }, { key: "status", label: "Status" },
  { key: "checkIn", label: "Check-in" }, { key: "checkOut", label: "Check-out" }, { key: "nights", label: "Nights", align: "right" },
  { key: "bookedOn", label: "Booked on" }, { key: "rate", label: "Rate/night", format: "money" }, { key: "charges", label: "Charges (ex-GST)", format: "money" },
  { key: "tax", label: "GST", format: "money" }, { key: "bill", label: "Bill", format: "money" }, { key: "paid", label: "Paid", format: "money" },
  { key: "balance", label: "Balance", format: "money" }, { key: "invoices", label: "Invoice no." },
];

export function BookingRegisterView({ rows, propertyNames, filename }: { rows: BookingRegisterEntry[]; propertyNames: Record<string, string>; filename: string }) {
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [duesOnly, setDuesOnly] = useState(false);
  const sources = useMemo(() => [...new Set(rows.map((r) => r.source))].sort(), [rows]);
  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status))], [rows]);

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return rows.filter((r) =>
      (!source || r.source === source) && (!status || r.status === status) && (!duesOnly || r.balancePaise > 0) &&
      (!k || [r.code, r.guestName, r.company ?? "", r.rooms, r.invoices].some((v) => v.toLowerCase().includes(k))));
  }, [rows, q, source, status, duesOnly]);

  const live = shown.filter((r) => r.status !== "CANCELLED" && r.status !== "NO_SHOW");
  const sum = (f: (r: BookingRegisterEntry) => number, list = shown) => list.reduce((n, r) => n + f(r), 0);
  const tiles = [
    { label: "Bookings", value: String(shown.length), hint: `${shown.length - live.length} cancelled / no-show` },
    { label: "Room-nights", value: String(sum((r) => r.nights, live)), hint: "excl. cancelled" },
    { label: "Billed", value: formatINR(sum((r) => r.billPaise)), hint: `${formatINR(sum((r) => r.taxPaise))} GST` },
    { label: "Collected", value: formatINR(sum((r) => r.paidPaise)), hint: "payments on these bookings" },
    { label: "Balance due", value: formatINR(sum((r) => Math.max(0, r.balancePaise))), hint: `${shown.filter((r) => r.balancePaise > 0).length} bookings` },
  ];

  const csvRows: ReportRow[] = shown.map((r) => ({
    code: r.code, guest: r.guestName, company: r.company ?? "", property: propertyNames[r.propertyId] ?? "", rooms: r.rooms, source: src(r.source),
    status: STATUS_LABEL[r.status] ?? r.status, checkIn: r.checkIn, checkOut: r.checkOut, nights: r.nights, bookedOn: r.bookedOn,
    rate: r.ratePaise, charges: r.chargesPaise, tax: r.taxPaise, bill: r.billPaise, paid: r.paidPaise, balance: r.balancePaise, invoices: r.invoices,
  }));
  const csvTotals: ReportRow = { code: "Total", nights: sum((r) => r.nights, live), charges: sum((r) => r.chargesPaise), tax: sum((r) => r.taxPaise), bill: sum((r) => r.billPaise), paid: sum((r) => r.paidPaise), balance: sum((r) => r.balancePaise) };

  const select = "h-11 rounded-md border bg-background px-3 text-sm";
  return (
    <section className="space-y-3" data-testid="booking-register">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">{t.label}</p>
            <p className="text-lg font-semibold tabular-nums">{t.value}</p>
            <p className="text-xs text-muted-foreground">{t.hint}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search guest, booking, room, invoice…" className="w-64" aria-label="Search bookings" data-testid="register-search" />
        <select className={select} value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source" data-testid="register-source">
          <option value="">All sources</option>
          {sources.map((s) => <option key={s} value={s}>{src(s)}</option>)}
        </select>
        <select className={select} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>)}
        </select>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={duesOnly} onChange={(e) => setDuesOnly(e.target.checked)} /> Only with balance due</label>
        <div className="ml-auto"><ExportTableButton filename={filename} columns={COLUMNS} rows={csvRows} totalsRow={csvTotals} /></div>
      </div>
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No bookings match.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                {["Booking", "Guest", "Hotel · room", "Source", "Stay", "Nights", "Bill", "Paid", "Balance", "Invoice"].map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-medium ${i >= 5 && i <= 8 ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.reservationId} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2.5"><Link href={`/bookings/${r.reservationId}`} className="font-mono font-medium text-primary underline-offset-2 hover:underline">{r.code}</Link>
                    <span className="block text-xs text-muted-foreground">{STATUS_LABEL[r.status] ?? r.status}</span></td>
                  <td className="px-3 py-2.5">{r.guestName}{r.company ? <span className="block text-xs text-muted-foreground">{r.company}</span> : null}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{propertyNames[r.propertyId] ?? ""}{r.rooms ? ` · ${r.rooms}` : ""}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{src(r.source)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{day(r.checkIn)} → {day(r.checkOut)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.nights}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(r.billPaise)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(r.paidPaise)}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${r.balancePaise > 0 ? "font-medium text-destructive" : "text-muted-foreground"}`}>{formatINR(r.balancePaise)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{r.invoices || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
