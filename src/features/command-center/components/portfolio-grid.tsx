"use client";

/**
 * Multi-property command centre — the per-hotel portfolio grid. Each card is one
 * property with its month-to-date KPIs, its manager, and a revenue share bar, plus
 * a "drill in" that switches the whole app's active property to that hotel and opens
 * its operational dashboard. This is what makes the multi-property architecture
 * obvious from the UI: Super Admin → every hotel, one screen, one tap to focus.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRight, BedDouble, LineChart, Percent, User } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn, formatINR } from "@/lib/utils";
import { switchProperty } from "@/features/platform/actions";
import type { PortfolioProperty } from "../queries";

const pct = (bps: number) => `${(bps / 100).toFixed(0)}%`;

export function PortfolioGrid({ properties, activePropertyId }: { properties: PortfolioProperty[]; activePropertyId: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const maxRevenue = Math.max(1, ...properties.map((p) => p.revenuePaise));

  const drillIn = (id: string) => {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      const result = await switchProperty({ propertyId: id });
      if (!result.ok) {
        setError(result.error.message);
        setBusyId(null);
        return;
      }
      router.push("/dashboard");
    });
  };

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="portfolio-grid">
        {properties.map((p) => {
          const isActive = p.id === activePropertyId;
          const share = Math.round((p.revenuePaise / maxRevenue) * 100);
          return (
            <Card key={p.id} className={cn("u-lift flex flex-col gap-3 p-4", isActive && "ring-1 ring-primary")}>
              {/* Identity */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold leading-tight">{p.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{p.city}</p>
                </div>
                <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium tracking-wide text-muted-foreground">{p.code}</span>
              </div>

              {/* Manager */}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <User className="size-3.5" />
                {p.managers.length ? p.managers.join(", ") : <span className="italic">No manager assigned</span>}
              </div>

              {/* KPIs */}
              <div className="grid grid-cols-3 gap-2 border-y py-2.5 text-center">
                <Metric icon={<Percent className="size-3.5" />} label="Occ." value={pct(p.occupancyBps)} />
                <Metric icon={<BedDouble className="size-3.5" />} label="ADR" value={formatINR(p.adrPaise)} />
                <Metric icon={<LineChart className="size-3.5" />} label="RevPAR" value={formatINR(p.revparPaise)} />
              </div>

              {/* Revenue + share bar */}
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-muted-foreground">Revenue (MTD)</span>
                  <span className="font-semibold tabular">{formatINR(p.revenuePaise)}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                </div>
              </div>

              {/* Drill-in */}
              <button
                type="button"
                onClick={() => drillIn(p.id)}
                disabled={pending}
                className={cn(
                  "mt-auto flex min-h-touch items-center justify-center gap-1.5 rounded-md border text-sm font-medium",
                  "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  pending && busyId === p.id && "opacity-60",
                )}
              >
                {isActive ? "Active — open dashboard" : "Open this hotel"}
                <ArrowRight className="size-4" />
              </button>
            </Card>
          );
        })}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-center gap-1 text-[0.7rem] text-muted-foreground">{icon}{label}</div>
      <p className="mt-0.5 truncate text-sm font-semibold tabular">{value}</p>
    </div>
  );
}
