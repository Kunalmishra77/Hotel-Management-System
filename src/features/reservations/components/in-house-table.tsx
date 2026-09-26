"use client";

/**
 * In-house guest table with instant search + date filters (client req). All rows
 * are already loaded, so filtering is client-side and immediate — search by guest /
 * property / room, and narrow by expected check-out date (who's leaving in a window)
 * or show only guests with a balance due.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { BedDouble, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatINR, formatDayMonth } from "@/lib/utils";

export type InHouseTableRow = {
  id: string;
  guestName: string;
  propertyName: string;
  rooms: string;
  adults: number;
  checkInDate: string; // ISO
  checkOutDate: string; // ISO
  balancePaise: number;
};

const isToday = (iso: string): boolean => new Date(iso).toDateString() === new Date().toDateString();
const dayKey = (iso: string): string => new Date(iso).toISOString().slice(0, 10);

export function InHouseTable({ rows }: { rows: InHouseTableRow[] }) {
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dueOnly, setDueOnly] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (needle && !`${r.guestName} ${r.propertyName} ${r.rooms}`.toLowerCase().includes(needle)) return false;
      const out = dayKey(r.checkOutDate);
      if (from && out < from) return false;
      if (to && out > to) return false;
      if (dueOnly && r.balancePaise <= 0) return false;
      return true;
    });
  }, [rows, q, from, to, dueOnly]);

  const cell = "h-10 rounded-md border border-input bg-background px-3 text-sm";
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search guest, property, room" className="pl-8" data-testid="inhouse-search" />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">Leaving from</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${cell} w-full`} aria-label="Check-out from" />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">Leaving to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${cell} w-full`} aria-label="Check-out to" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)} className="size-4" /> Balance due only
        </label>
      </div>

      {(q || from || to || dueOnly) && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{filtered.length} of {rows.length} shown</span>
          <button type="button" className="underline" onClick={() => { setQ(""); setFrom(""); setTo(""); setDueOnly(false); }}>Clear filters</button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/30 p-12 text-center">
          <BedDouble className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">No matching guests</p>
          <p className="mt-1 text-sm text-muted-foreground">Adjust the search or date filters.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Guest</th>
                <th className="py-2 px-3 font-medium">Property</th>
                <th className="py-2 px-3 font-medium">Room</th>
                <th className="py-2 px-3 font-medium">Guests</th>
                <th className="py-2 px-3 font-medium">Check-in</th>
                <th className="py-2 px-3 font-medium">Expected check-out</th>
                <th className="py-2 px-3 text-right font-medium">Payment</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="py-2.5 pr-3 font-medium"><Link href={`/bookings/${r.id}`} className="hover:underline">{r.guestName}</Link></td>
                  <td className="py-2.5 px-3 text-muted-foreground">{r.propertyName}</td>
                  <td className="py-2.5 px-3 font-mono text-xs">{r.rooms}</td>
                  <td className="py-2.5 px-3 tabular text-muted-foreground">{r.adults}</td>
                  <td className="py-2.5 px-3 whitespace-nowrap">{formatDayMonth(r.checkInDate)}</td>
                  <td className="py-2.5 px-3 whitespace-nowrap">{formatDayMonth(r.checkOutDate)}{isToday(r.checkOutDate) ? <span className="ml-1 text-xs text-amber-600">(today)</span> : null}</td>
                  <td className="py-2.5 px-3 text-right tabular">
                    {r.balancePaise > 0 ? <span className="font-semibold text-amber-700 dark:text-amber-400">{formatINR(r.balancePaise)} due</span> : <span className="text-success">Settled</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
