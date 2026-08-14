import * as React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ArrowRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "./card";

type Trend = "up" | "down" | "flat";

/**
 * KPI card — the dashboard workhorse. Summary-first: big value, a labelled
 * delta with a directional cue, and room for a sparkline (as `children`).
 * `goodDirection` decides whether "up" is coloured positive or negative.
 *
 * Pass `href` to make the whole card a link (Phase 5) — the number becomes a door
 * to the records behind it, with a hover-lift + keyboard focus. Without `href`
 * it is exactly the static card it always was.
 */
export function KpiCard({
  label,
  value,
  delta,
  trend = "flat",
  goodDirection = "up",
  icon,
  hint,
  href,
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
  href?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const positive = trend === "flat" ? null : trend === goodDirection;
  const TrendIcon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;
  const clickable = Boolean(href);

  const body = (
    <Card
      className={cn(
        "p-4",
        clickable && "u-lift group h-full transition hover:border-primary/40",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {clickable ? (
          <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
        ) : icon ? (
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

  if (!href) return body;
  return (
    <Link href={href} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      {body}
    </Link>
  );
}
