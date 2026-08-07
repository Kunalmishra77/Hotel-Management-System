"use client";

/**
 * Single-series trend chart (dataviz). One measure over time → an area line: 2px
 * stroke in the design system's `--chart-1` hue, a faint gradient fill, recessive
 * grid/axes in token ink, and a crosshair+tooltip on hover. One series needs no
 * legend — the caption/title names it. Theme-aware: colours are CSS vars, so light
 * and dark are each stepped from the same ramp, not an auto-flip.
 *
 * Props are serialisable (a `format` enum, not a formatter fn) so a server
 * component can render it directly.
 */
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type TrendPoint = { label: string; value: number };
export type TrendFormat = "inr" | "percent" | "number";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Deterministic (no locale/tz) so SSR and the browser render identically. */
function fmtLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]} ${MONTHS[Number(m[2]) - 1] ?? ""}`;
}

/** Compact so axis ticks don't collide: ₹1.2L, ₹12k, 84%, 1,234. */
function fmtValue(v: number, format: TrendFormat): string {
  if (format === "percent") return `${Math.round(v / 100)}%`; // bps → %
  if (format === "number") return v.toLocaleString("en-IN");
  const r = v / 100; // paise → ₹
  if (r >= 1e7) return `₹${(r / 1e7).toFixed(1)}Cr`;
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(1)}L`;
  if (r >= 1e3) return `₹${(r / 1e3).toFixed(1)}k`;
  return `₹${Math.round(r)}`;
}

function ChartTooltip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: { value?: number }[];
  label?: string | number;
  format: TrendFormat;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-card">
      <p className="text-muted-foreground">{fmtLabel(String(label))}</p>
      <p className="font-display font-semibold tabular text-foreground">
        {fmtValue(Number(payload[0]?.value ?? 0), format)}
      </p>
    </div>
  );
}

export function TrendChart({
  data,
  format,
  height = 220,
  emptyLabel = "No data for this range yet.",
}: {
  data: TrendPoint[];
  format: TrendFormat;
  height?: number;
  emptyLabel?: string;
}) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground"
        style={{ height }}
        data-testid="trend-chart-empty"
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height }} data-testid="trend-chart">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.22} />
              <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
          <XAxis
            dataKey="label"
            tickFormatter={fmtLabel}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={(v: number) => fmtValue(v, format)}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            width={52}
          />
          <Tooltip
            cursor={{ stroke: "hsl(var(--chart-1))", strokeWidth: 1, strokeOpacity: 0.5 }}
            content={({ active, payload, label }) => (
              <ChartTooltip
                active={active}
                payload={payload as { value?: number }[] | undefined}
                label={label as string | number | undefined}
                format={format}
              />
            )}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="hsl(var(--chart-1))"
            strokeWidth={2}
            fill="url(#trend-fill)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0, fill: "hsl(var(--chart-1))" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
