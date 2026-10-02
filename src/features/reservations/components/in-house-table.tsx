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
import { PropertyBadge } from "@/components/ui/property-badge";
import { propertyColor } from "@/lib/property-colors";
import { cn, formatINR, formatDayMonth } from "@/lib/utils";

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
const todayKey = (): string => new Date().toISOString().slice(0, 10);
/** Expected check-out already passed but the guest is still in-house = overstay. */
const isOverdue = (iso: string): boolean => dayKey(iso) < todayKey();

export function InHouseTable({ rows }: { rows: InHouseTableRow[] }) {
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [overstayOnly, setOverstayOnly] = useState(false);
  const [prop, setProp] = useState<string | null>(null);

  // Per-property counts for the filter chips (client req #8).
  const properties = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.propertyName, (m.get(r.propertyName) ?? 0) + 1);
    return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (prop && r.propertyName !== prop) return false;
      if (needle && !`${r.guestName} ${r.propertyName} ${r.rooms}`.toLowerCase().includes(needle)) return false;
      const out = dayKey(r.checkOutDate);
      if (from && out < from) return false;
      if (to && out > to) return false;
      if (dueOnly && r.balancePaise <= 0) return false;
      if (overstayOnly && !isOverdue(r.checkOutDate)) return false;
      return true;
    });
  }, [rows, prop, q, from, to, dueOnly, overstayOnly]);

  const cell = "h-10 rounded-md border border-input bg-background px-3 text-sm";
  return (
    <div className="space-y-3">
      {properties.length > 1 && (
        <div className="flex flex-wrap items-center gap-2" data-testid="inhouse-property-chips">
          <button type="button" onClick={() => setProp(null)}
            className={cn("rounded-full border px-3 py-0.5 text-xs font-medium transition-colors", prop === null ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}>
            All ({rows.length})
          </button>
          {properties.map((p) => {
            const c = propertyColor(p.name);
            const active = prop === p.name;
            return (
              <button key={p.name} type="button" onClick={() => setProp(active ? null : p.name)}
                className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-xs font-medium transition-colors", active ? c.badge + " ring-2 ring-offset-1 ring-current" : c.badge + " opacity-80 hover:opacity-100")}>
                <span className={cn("size-1.5 shrink-0 rounded-full", c.dot)} aria-hidden="true" />
                {p.name} · {p.count}
              </button>
            );
          })}
        </div>
      )}
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
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)} className="size-4" /> Balance due only
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={overstayOnly} onChange={(e) => setOverstayOnly(e.target.checked)} className="size-4" data-testid="inhouse-overstay" /> Overstay only
          </label>
        </div>
      </div>

      {(q || from || to || dueOnly || overstayOnly || prop) && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{filtered.length} of {rows.length} shown</span>
          <button type="button" className="underline" onClick={() => { setQ(""); setFrom(""); setTo(""); setDueOnly(false); setOverstayOnly(false); setProp(null); }}>Clear filters</button>
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
                <th className="py-2 pl-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const overdue = isOverdue(r.checkOutDate);
                return (
                <tr key={r.id} className={`border-b last:border-0 hover:bg-muted/40 ${overdue ? "bg-destructive/5" : propertyColor(r.propertyName).row}`}>
                  <td className="py-2.5 pr-3 font-medium"><Link href={`/bookings/${r.id}`} className="hover:underline">{r.guestName}</Link></td>
                  <td className="py-2.5 px-3"><PropertyBadge name={r.propertyName} /></td>
                  <td className="py-2.5 px-3 font-mono text-xs">{r.rooms}</td>
                  <td className="py-2.5 px-3 tabular text-muted-foreground">{r.adults}</td>
                  <td className="py-2.5 px-3 whitespace-nowrap">{formatDayMonth(r.checkInDate)}</td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {formatDayMonth(r.checkOutDate)}
                    {overdue ? <span className="ml-1 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">Overstay</span>
                      : isToday(r.checkOutDate) ? <span className="ml-1 text-xs text-amber-600">(today)</span> : null}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular">
                    {r.balancePaise > 0 ? <span className="font-semibold text-amber-700 dark:text-amber-400">{formatINR(r.balancePaise)} due</span> : <span className="text-success">Settled</span>}
                  </td>
                  <td className="py-2.5 pl-3 text-right whitespace-nowrap">
                    <Link href={`/bookings/${r.id}/folio`} className="text-primary underline-offset-4 hover:underline">Folio</Link>
                    <span className="px-1.5 text-muted-foreground">·</span>
                    <Link href={`/bookings/${r.id}`} className="text-primary underline-offset-4 hover:underline">Open</Link>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
