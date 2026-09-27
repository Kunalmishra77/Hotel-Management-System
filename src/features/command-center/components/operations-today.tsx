/**
 * Operations Today — the front-desk command strip on the Dashboard (Phase-3
 * flagship, data-dense style). Three panels: a prioritised ACTION QUEUE (what needs
 * doing right now, each a live count → the screen that clears it), and today's
 * ARRIVALS and DEPARTURES as real lists (guest · property · room · balance due), so
 * reception can act without leaving the dashboard. All data is live and scoped.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, LogIn, LogOut } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/utils";
import type { TodayMovement } from "@/features/reservations/queries";

export type QueueItem = { label: string; count: number; href: string; icon: ReactNode; tone?: "warn" | "bad" | "good" };

const TONE_DOT: Record<string, string> = {
  warn: "bg-amber-500",
  bad: "bg-destructive",
  good: "bg-success",
};

export function OperationsToday({
  queue,
  arrivals,
  departures,
}: {
  queue: QueueItem[];
  arrivals: TodayMovement[];
  departures: TodayMovement[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Action queue */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Action queue</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <ul className="divide-y">
            {queue.map((q) => (
              <li key={q.label}>
                <Link href={q.href} className="group flex items-center justify-between gap-3 py-2 text-sm transition hover:bg-muted/50">
                  <span className="inline-flex items-center gap-2 text-muted-foreground [&_svg]:size-4 [&_svg]:text-foreground/70">
                    {q.icon} <span className="text-foreground">{q.label}</span>
                  </span>
                  <span className="inline-flex items-center gap-2">
                    {q.count > 0 && q.tone ? <span className={`size-1.5 rounded-full ${TONE_DOT[q.tone]}`} aria-hidden /> : null}
                    <span className={`tabular font-semibold ${q.count === 0 ? "text-muted-foreground" : ""}`}>{q.count}</span>
                    <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <MovementList title="Arrivals today" icon={<LogIn />} rows={arrivals} emptyLabel="No arrivals scheduled today." href="/bookings?desk=1" cta="Front desk" />
      <MovementList title="Departures today" icon={<LogOut />} rows={departures} emptyLabel="No departures due today." href="/in-house" cta="In-house" showBalance />
    </div>
  );
}

/** Today's arrivals + departures as a standalone two-column pair (portfolio views). */
export function TodayMovements({ arrivals, departures }: { arrivals: TodayMovement[]; departures: TodayMovement[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <MovementList title="Arrivals today" icon={<LogIn />} rows={arrivals} emptyLabel="No arrivals scheduled today." href="/bookings?desk=1" cta="Front desk" />
      <MovementList title="Departures today" icon={<LogOut />} rows={departures} emptyLabel="No departures due today." href="/in-house" cta="In-house" showBalance />
    </div>
  );
}

export function MovementList({
  title,
  icon,
  rows,
  emptyLabel,
  href,
  cta,
  showBalance,
}: {
  title: string;
  icon: ReactNode;
  rows: TodayMovement[];
  emptyLabel: string;
  href: string;
  cta: string;
  showBalance?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="inline-flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary">{icon} {title} <span className="text-sm font-normal text-muted-foreground">({rows.length})</span></CardTitle>
        <Link href={href} className="text-xs font-medium text-primary underline-offset-4 hover:underline">{cta} →</Link>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {rows.slice(0, 12).map((r) => (
              <li key={r.id}>
                <Link href={`/bookings/${r.id}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition hover:bg-muted/60">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.guestName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{r.propertyName} · Room {r.rooms}</span>
                  </span>
                  {showBalance && r.balancePaise > 0 ? (
                    <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">{formatINR(r.balancePaise)} due</span>
                  ) : (
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{r.code}</span>
                  )}
                </Link>
              </li>
            ))}
            {rows.length > 12 ? <li className="px-2 pt-1 text-xs text-muted-foreground">+{rows.length - 12} more…</li> : null}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
