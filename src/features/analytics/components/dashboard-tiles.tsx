"use client";

/**
 * Dashboard tiles — 14 T-18/T-20 (FR-2/14, AC-3/6/7). Permission-aware: the
 * server already nulls financial fields for roles without report:view-financial,
 * so this simply omits those tiles. Includes a permissioned manual night-audit
 * trigger. Mobile-first grid.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { runNightAuditAction } from "../actions";
import type { LiveTiles } from "../queries";

const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;
const pct = (bps: number) => `${(bps / 100).toFixed(0)}%`;

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

  return (
    <div className="space-y-3" data-testid="dashboard-tiles">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile label="Occupancy" value={pct(tiles.occupancyBps)} testid="tile-occupancy" />
        <Tile label="Occupied" value={String(tiles.rooms.occupied)} testid="tile-occupied" />
        <Tile label="Vacant" value={String(tiles.rooms.vacant)} />
        <Tile label="Arrivals today" value={String(tiles.arrivalsToday)} />
        <Tile label="Departures today" value={String(tiles.departuresToday)} />
        <Tile label="Housekeeping" value={String(tiles.rooms.housekeeping)} />
        {tiles.revenueTodayPaise !== null && <Tile label="Revenue today" value={rupees(tiles.revenueTodayPaise)} testid="tile-revenue" />}
        {tiles.expenseTodayPaise !== null && <Tile label="Expenses today" value={rupees(tiles.expenseTodayPaise)} />}
        {tiles.pendingPaise !== null && <Tile label="Pending" value={rupees(tiles.pendingPaise)} testid="tile-pending" />}
      </div>

      {canRunAudit && propertyId && (
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" disabled={pending} onClick={runAudit} data-testid="run-night-audit">
            {pending ? "Running…" : "Run night audit"}
          </Button>
          {message && <span className="text-sm text-muted-foreground" data-testid="audit-message">{message}</span>}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, testid }: { label: string; value: string; testid?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold" data-testid={testid}>{value}</p>
      </CardContent>
    </Card>
  );
}
