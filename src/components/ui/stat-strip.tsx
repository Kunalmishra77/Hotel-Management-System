import { cn } from "@/lib/utils";

/**
 * Compact operational stat strip — a dense row of number+label tiles for the
 * mobile-first operations screens (housekeeping/maintenance/inventory) where a
 * full KpiCard row would be too heavy. Tone colours the number for at-a-glance
 * attention (warning/danger/success). Presentational; server- or client-safe.
 */
export type Stat = {
  label: string;
  value: number | string;
  tone?: "default" | "warning" | "danger" | "success";
};

export function StatStrip({ items, className }: { items: Stat[]; className?: string }) {
  return (
    <div className={cn("grid grid-cols-3 gap-2 sm:grid-cols-5", className)} data-testid="stat-strip">
      {items.map((s) => (
        <div key={s.label} className="rounded-lg border bg-card p-2.5 text-center">
          <p
            className={cn(
              "font-display text-xl font-bold tabular leading-none",
              s.tone === "warning" && "text-warning",
              s.tone === "danger" && "text-destructive",
              s.tone === "success" && "text-success",
            )}
          >
            {s.value}
          </p>
          <p className="mt-1 text-[0.7rem] leading-tight text-muted-foreground">{s.label}</p>
        </div>
      ))}
    </div>
  );
}
