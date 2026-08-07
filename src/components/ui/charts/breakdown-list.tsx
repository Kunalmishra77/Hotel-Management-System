/**
 * Ranked magnitude breakdown (dataviz): a horizontal bar per category, one hue
 * (magnitude ranking — the label carries identity, so no categorical palette
 * needed), bar width proportional to the row's share of the max. Server-renderable
 * (no interactivity). Values wear text tokens; only the bar carries the hue.
 */
import { formatINR } from "@/lib/utils";

export type BreakdownItem = { label: string; value: number };

export function BreakdownList({
  items,
  format = "inr",
  emptyLabel = "Nothing in this range yet.",
}: {
  items: BreakdownItem[];
  format?: "inr" | "number";
  emptyLabel?: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  const max = Math.max(1, ...items.map((i) => i.value));
  const fmt = (v: number) => (format === "inr" ? formatINR(v) : v.toLocaleString("en-IN"));

  return (
    <ul className="space-y-2.5">
      {items.map((it) => (
        <li key={it.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{it.label}</span>
            <span className="shrink-0 font-medium tabular">{fmt(it.value)}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-chart-1"
              style={{ width: `${Math.max(2, Math.round((it.value / max) * 100))}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
