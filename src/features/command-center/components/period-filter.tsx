"use client";
/**
 * Time-lens filter — the command centre's date control. Preset chips (Today →
 * This Year) plus a custom range, and an optional property scope. Navigates by
 * updating the URL (`?period=`, `?from=&to=`, `?property=`) so the server
 * recomputes; the whole dashboard reads a period-over-period delta off it.
 */
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState } from "react";
import { CalendarRange, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { PERIOD_PRESETS, PERIOD_LABEL, type Period } from "../domain/period";

export function PeriodFilter({
  period,
  from,
  to,
  properties,
  activeProperty,
}: {
  period: Period;
  from: string;
  to: string;
  properties?: { id: string; name: string }[];
  activeProperty?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(period === "custom");
  const [cFrom, setCFrom] = useState(from);
  const [cTo, setCTo] = useState(to);

  const nav = (next: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) sp.delete(k);
      else sp.set(k, v);
    }
    router.push(`${pathname}?${sp.toString()}`);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {PERIOD_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => { setOpen(false); nav({ period: p, from: null, to: null }); }}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              period === p ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            {PERIOD_LABEL[p]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            period === "custom" ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
          )}
        >
          <CalendarRange className="size-3.5" aria-hidden="true" /> Custom
        </button>

        {properties && properties.length > 1 && (
          <select
            value={activeProperty ?? "all"}
            onChange={(e) => nav({ property: e.target.value === "all" ? null : e.target.value })}
            className="ml-auto rounded-full border bg-card px-3 py-1 text-xs font-medium"
            aria-label="Property scope"
          >
            <option value="all">All properties</option>
            {properties.map((pr) => (
              <option key={pr.id} value={pr.id}>{pr.name}</option>
            ))}
          </select>
        )}
      </div>

      {open && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-2.5">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            From
            <input type="date" value={cFrom} max={cTo || undefined} onChange={(e) => setCFrom(e.target.value)} className="rounded-md border bg-background px-2 py-1 text-sm text-foreground" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            To
            <input type="date" value={cTo} min={cFrom || undefined} onChange={(e) => setCTo(e.target.value)} className="rounded-md border bg-background px-2 py-1 text-sm text-foreground" />
          </label>
          <button
            type="button"
            disabled={!cFrom || !cTo}
            onClick={() => nav({ period: "custom", from: cFrom, to: cTo })}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
          >
            <Check className="size-4" aria-hidden="true" /> Apply
          </button>
        </div>
      )}
    </div>
  );
}
