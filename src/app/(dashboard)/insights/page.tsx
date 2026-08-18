import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Trophy, TrendingDown } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { parsePeriod, periodRange, PERIOD_PRESETS, PERIOD_LABEL } from "@/features/command-center/domain/period";
import { getPortfolio, type PortfolioProperty } from "@/features/command-center/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Portfolio insights" };
const pct = (bps: number) => `${(bps / 100).toFixed(0)}%`;

/**
 * Super Admin · Portfolio Insights (architecture v2 · Phase 2). Every property
 * ranked and compared against the rest — best/lowest performer, revenue and
 * occupancy league tables. Read-only; reuses the canonical portfolio metrics.
 */
export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const user = await requirePermission("report:view-financial");
  const today = new Date();
  const period = parsePeriod((await searchParams).period);
  const { from, label: periodLabel } = periodRange(period, today);
  const portfolio = await getPortfolio(user, from, today);
  const props = portfolio.properties;

  if (props.length < 2) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <PageHeader title="Portfolio insights" description="Compare every hotel against the rest." />
        <EmptyState title="Need more than one property" description="Portfolio insights compare hotels — add a second property to see rankings." />
      </div>
    );
  }

  const byRevenue = [...props].sort((a, b) => b.revenuePaise - a.revenuePaise);
  const byOccupancy = [...props].sort((a, b) => b.occupancyBps - a.occupancyBps);
  const byRevpar = [...props].sort((a, b) => b.revparPaise - a.revparPaise);
  const best = byRevenue[0]!;
  const lowest = byRevenue[byRevenue.length - 1]!;
  const maxRev = Math.max(1, ...props.map((p) => p.revenuePaise));

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader
        title="Portfolio insights"
        description={`Every hotel, ranked · ${periodLabel}`}
        actions={
          <div className="inline-flex items-center rounded-lg border bg-card p-0.5 text-sm" role="group" aria-label="Date range">
            {PERIOD_PRESETS.map((per) => (
              <Link
                key={per}
                href={per === "mtd" ? "/insights" : `/insights?period=${per}`}
                className={per === period ? "rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground" : "rounded-md px-2.5 py-1 text-muted-foreground hover:text-foreground"}
              >
                {PERIOD_LABEL[per]}
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-emerald-600/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
              <Trophy className="size-4" aria-hidden="true" /> Best performer
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{best.name}</p>
            <p className="text-sm text-muted-foreground">{formatINR(best.revenuePaise)} · {pct(best.occupancyBps)} occ · RevPAR {formatINR(best.revparPaise)}</p>
          </CardContent>
        </Card>
        <Card className="border-amber-600/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
              <TrendingDown className="size-4" aria-hidden="true" /> Needs attention
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{lowest.name}</p>
            <p className="text-sm text-muted-foreground">{formatINR(lowest.revenuePaise)} · {pct(lowest.occupancyBps)} occ · RevPAR {formatINR(lowest.revparPaise)}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Revenue league</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {byRevenue.map((p, i) => (
            <RankRow key={p.id} rank={i + 1} p={p} share={Math.round((p.revenuePaise / maxRev) * 100)} value={formatINR(p.revenuePaise)} />
          ))}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <LeagueCard title="Occupancy" rows={byOccupancy} value={(p) => pct(p.occupancyBps)} />
        <LeagueCard title="RevPAR" rows={byRevpar} value={(p) => formatINR(p.revparPaise)} />
      </div>
    </div>
  );
}

function RankRow({ rank, p, share, value }: { rank: number; p: PortfolioProperty; share: number; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold tabular">{rank}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <Link href={`/overview/${p.id}`} className="truncate text-sm font-medium hover:underline">{p.name}</Link>
          <span className="shrink-0 text-sm font-semibold tabular">{value}</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
        </div>
      </div>
    </div>
  );
}

function LeagueCard({ title, rows, value }: { title: string; rows: PortfolioProperty[]; value: (p: PortfolioProperty) => string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title} ranking</CardTitle></CardHeader>
      <CardContent>
        <ol className="space-y-1.5">
          {rows.map((p, i) => (
            <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="inline-flex min-w-0 items-center gap-2">
                <span className="text-xs text-muted-foreground tabular">{i + 1}</span>
                <Link href={`/overview/${p.id}`} className="inline-flex items-center gap-1 truncate hover:underline">
                  {p.name} <ArrowUpRight className="size-3 text-muted-foreground" aria-hidden="true" />
                </Link>
              </span>
              <span className="shrink-0 font-medium tabular">{value(p)}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
