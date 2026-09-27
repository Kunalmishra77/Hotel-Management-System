/**
 * Sparkline — a tiny inline-SVG trend line for KPI cards (no library, server-safe).
 * Shows the shape of a metric over the period at a glance; the last point gets a
 * dot. Theme-aware via the chart-1 token. Purely decorative context for the big
 * number above it, so it carries an empty aria (the number + delta convey value).
 */
export function Sparkline({
  data,
  height = 28,
  className,
}: {
  data: number[];
  height?: number;
  className?: string;
}) {
  const pts = data.filter((n) => Number.isFinite(n));
  if (pts.length < 2) return <div style={{ height }} className={className} aria-hidden />;

  const w = 100; // viewBox width; scales to container
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const stepX = w / (pts.length - 1);
  const y = (v: number) => height - ((v - min) / span) * (height - 4) - 2;
  const coords = pts.map((v, i) => [i * stepX, y(v)] as const);
  const line = coords.map(([x, yy], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${yy.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${height} L0,${height} Z`;
  const last = coords[coords.length - 1]!;
  const rising = pts[pts.length - 1]! >= pts[0]!;
  const stroke = rising ? "hsl(var(--chart-2))" : "hsl(var(--chart-6))";

  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height} className={className} role="img" aria-label="">
      <path d={area} fill={stroke} fillOpacity={0.1} stroke="none" />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2} fill={stroke} />
    </svg>
  );
}
