/**
 * The occupancy bar on a property tile — 01 T-13 (AC-6).
 *
 * design.md draws it as `▉▉▉░░░░░░░  33% occ`. The label says "current-status"
 * because `reporting.md` insists this figure is NOT the ADR/RevPAR denominator
 * and must be labelled as such — an unlabelled "33% occ" beside a revenue
 * figure is exactly the confusion the rule exists to prevent.
 */
import { cn } from "@/lib/utils";
import { formatOccupancyPercent, type OccupancyRollup } from "../domain/occupancy";

export function OccupancyBar({
  occupancy,
  className,
}: {
  occupancy: OccupancyRollup;
  className?: string;
}) {
  const percent = Math.round(occupancy.occupancyBps / 100);
  const label = formatOccupancyPercent(occupancy.occupancyBps);

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <div
          role="meter"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Current-status occupancy: ${label}, ${occupancy.occupied} of ${occupancy.availableForOccupancy} sellable rooms occupied`}
          className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500 ease-out",
              percent >= 85
                ? "bg-status-occupied"
                : percent >= 50
                  ? "bg-status-reserved"
                  : "bg-status-vacant",
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums">{label}</span>
      </div>
      <p className="text-xs text-muted-foreground">current-status occupancy</p>
    </div>
  );
}

/**
 * The status breakdown line: "10 rms · 6 vac · 3 occ · 1 maint".
 * Zero-count statuses are omitted so a phone line stays readable.
 */
export function OccupancyCounts({ occupancy }: { occupancy: OccupancyRollup }) {
  const parts: string[] = [`${occupancy.total} rms`];
  if (occupancy.vacant) parts.push(`${occupancy.vacant} vac`);
  if (occupancy.occupied) parts.push(`${occupancy.occupied} occ`);
  if (occupancy.reserved) parts.push(`${occupancy.reserved} resv`);
  if (occupancy.housekeeping) parts.push(`${occupancy.housekeeping} hskp`);
  if (occupancy.maintenance) parts.push(`${occupancy.maintenance} maint`);

  return <p className="text-sm text-muted-foreground">{parts.join(" · ")}</p>;
}
