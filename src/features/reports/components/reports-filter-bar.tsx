"use client";

/**
 * Reports filter — period + property set, in the URL (shareable / bookmarkable).
 * Period = a month (This month / Last month / any month) or a custom date range.
 * Changing a filter keeps the report tab and its options (it used to jump back to
 * Profit & loss).
 */
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type PropertyOption = { id: string; name: string; code: string };

const monthOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7);

export function ReportsFilterBar({
  properties,
  selected,
  month,
  range,
}: {
  properties: PropertyOption[];
  selected: string[];
  month: string;
  /** A custom range in use (YYYY-MM-DD), else null. */
  range: { from: string; to: string } | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const allSelected = selected.length >= properties.length;
  const [custom, setCustom] = useState(range !== null);
  const [from, setFrom] = useState(range?.from ?? `${month}-01`);
  const [to, setTo] = useState(range?.to ?? new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));

  const push = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") next.delete(k); else next.set(k, v); }
    router.push(`${pathname}?${next.toString()}`);
  };
  const goMonth = (m: string) => { setCustom(false); push({ month: m, from: null, to: null }); };
  const goProps = (ids: string[]) => push({ properties: ids.length > 0 && ids.length < properties.length ? ids.join(",") : null });

  const now = new Date();
  const thisMonth = monthOf(now);
  const lastMonth = monthOf(new Date(now.getFullYear(), now.getMonth() - 1, 15));

  const toggle = (id: string) => {
    if (allSelected) { goProps([id]); return; }
    const set = new Set(selected);
    if (set.has(id)) set.delete(id); else set.add(id);
    if (set.size === 0) return;
    goProps([...set]);
  };

  return (
    <div className="space-y-2" data-testid="reports-filter">
      <div className="flex flex-wrap items-center gap-2">
        <Chip active={!range && month === thisMonth} onClick={() => goMonth(thisMonth)}>This month</Chip>
        <Chip active={!range && month === lastMonth} onClick={() => goMonth(lastMonth)}>Last month</Chip>
        <Input type="month" value={range ? "" : month} onChange={(e) => e.target.value && goMonth(e.target.value)} className="w-40" aria-label="Month" data-testid="report-month" />
        <Chip active={custom || !!range} onClick={() => setCustom(true)}>Custom dates</Chip>
        {custom || range ? (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (from && to && from <= to) push({ from, to, month: null }); }}>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="From" data-testid="report-from" />
            <span className="text-sm text-muted-foreground">to</span>
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="To" data-testid="report-to" />
            <Button type="submit" size="sm" disabled={!from || !to || from > to}>Show</Button>
          </form>
        ) : null}
      </div>
      {properties.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          <Chip active={allSelected} onClick={() => goProps(properties.map((p) => p.id))}>All hotels</Chip>
          {properties.map((p) => (
            <Chip key={p.id} active={!allSelected && selected.includes(p.id)} onClick={() => toggle(p.id)}>{p.code}</Chip>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-touch rounded-full border px-3 text-sm transition-colors ${
        active ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
