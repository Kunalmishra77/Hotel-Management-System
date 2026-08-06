import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "./card";

type Trend = "up" | "down" | "flat";

/**
 * KPI card — the dashboard workhorse. Summary-first: big value, a labelled
 * delta with a directional cue, and room for a sparkline (as `children`).
 * `goodDirection` decides whether "up" is coloured positive or negative.
 */
export function KpiCard({
  label,
  value,
  delta,
  trend = "flat",
  goodDirection = "up",
  icon,
  hint,
  className,
  children,
}: {
  label: string;
  value: React.ReactNode;
  delta?: string;
  trend?: Trend;
  goodDirection?: "up" | "down";
  icon?: React.ReactNode;
  hint?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const positive = trend === "flat" ? null : trend === goodDirection;
  const TrendIcon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;
  return (
    <Card className={cn("p-4", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {icon ? (
          <span className="grid size-8 place-items-center rounded-md bg-primary/10 text-primary [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
      </div>
      <div className="mt-2 font-display text-2xl font-bold tabular leading-none tracking-tight">
        {value}
      </div>
      {delta || hint ? (
        <div className="mt-2 flex items-center gap-1.5 text-xs">
          {delta ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 font-medium tabular",
                positive === null
                  ? "text-muted-foreground"
                  : positive
                    ? "text-success"
                    : "text-destructive",
              )}
            >
              <TrendIcon className="size-3.5" />
              {delta}
            </span>
          ) : null}
          {hint ? <span className="text-muted-foreground">{hint}</span> : null}
        </div>
      ) : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </Card>
  );
}
