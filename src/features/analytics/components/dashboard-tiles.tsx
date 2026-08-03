"use client";

/**
 * Dashboard tiles — 14 T-18/T-20 (FR-2/14, AC-3/6/7). Permission-aware: the
 * server already nulls financial fields for roles without report:view-financial,
 * so this simply omits those tiles. Includes a permissioned manual night-audit
 * trigger. Mobile-first, grouped bands with iconography + semantic tone.
 */
import { useState, useTransition, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import {
  BedDouble, DoorOpen, Gauge, LogIn, LogOut, Sparkles,
  IndianRupee, Receipt, Clock, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { runNightAuditAction } from "../actions";
import type { LiveTiles } from "../queries";

const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const pct = (bps: number) => `${(bps / 100).toFixed(0)}%`;

type Tone = "default" | "accent" | "warn";

export function DashboardTiles({
  tiles,
  propertyId,
  canRunAudit,
}: {
  tiles: LiveTiles;
  propertyId: string | null;
  canRunAudit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const runAudit = () => {
    if (!propertyId) return;
    setMessage(null);
    start(async () => {
      const res = await runNightAuditAction({ propertyId });
      setMessage(res.ok ? `Night audit: ${res.data.status.toLowerCase().replace("_", " ")}.` : res.error.message);
      if (res.ok) router.refresh();
    });
  };

  const money = tiles.revenueTodayPaise !== null;

  return (
    <div className="space-y-5" data-testid="dashboard-tiles">
      {canRunAudit && propertyId && (
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" disabled={pending} onClick={runAudit} data-testid="run-night-audit" className="gap-1.5">
            <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} aria-hidden="true" />
            {pending ? "Running…" : "Run night audit"}
          </Button>
          {message && <span className="text-sm text-muted-foreground" data-testid="audit-message">{message}</span>}
        </div>
      )}

      <Band label="Occupancy now">
        <Tile icon={Gauge} label="Occupancy" value={pct(tiles.occupancyBps)} tone="accent" bar={tiles.occupancyBps / 100} testid="tile-occupancy" />
        <Tile icon={BedDouble} label="Occupied" value={String(tiles.rooms.occupied)} testid="tile-occupied" />
        <Tile icon={DoorOpen} label="Vacant" value={String(tiles.rooms.vacant)} />
        <Tile icon={Sparkles} label="Housekeeping" value={String(tiles.rooms.housekeeping)} />
      </Band>

      <Band label="Today">
        <Tile icon={LogIn} label="Arrivals" value={String(tiles.arrivalsToday)} />
        <Tile icon={LogOut} label="Departures" value={String(tiles.departuresToday)} />
        {money && <Tile icon={IndianRupee} label="Revenue" value={rupees(tiles.revenueTodayPaise!)} tone="accent" testid="tile-revenue" />}
        {tiles.expenseTodayPaise !== null && <Tile icon={Receipt} label="Expenses" value={rupees(tiles.expenseTodayPaise)} />}
        {tiles.pendingPaise !== null && (
          <Tile icon={Clock} label="Pending" value={rupees(tiles.pendingPaise)} tone={tiles.pendingPaise > 0 ? "warn" : "default"} testid="tile-pending" />
        )}
      </Band>
    </div>
  );
}

function Band({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>
    </section>
  );
}

const TONE: Record<Tone, { chip: string; num: string; fill: string }> = {
  default: { chip: "bg-muted text-foreground/70", num: "text-foreground", fill: "bg-muted-foreground/40" },
  accent: { chip: "bg-primary/10 text-primary", num: "text-foreground", fill: "bg-primary" },
  warn: { chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400", num: "text-amber-600 dark:text-amber-400", fill: "bg-amber-500" },
};

function Tile({
  icon: Icon, label, value, tone = "default", bar, testid,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string; value: string; tone?: Tone; bar?: number; testid?: string;
}) {
  const t = TONE[tone];
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className={`flex size-8 items-center justify-center rounded-lg ${t.chip}`}>
        <Icon className="size-4" />
      </div>
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-2xl font-semibold tabular-nums tracking-tight ${t.num}`} data-testid={testid}>{value}</p>
      {bar !== undefined && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className={`h-full rounded-full ${t.fill}`} style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} />
        </div>
      )}
    </div>
  );
}
