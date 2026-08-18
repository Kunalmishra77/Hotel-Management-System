/**
 * Multi-property overview — 01 T-13 (FR-6/FR-8, AC-6/AC-8).
 *
 * Server Component: the list is already scoped by `propertyOverview(user)`, so
 * a property outside the caller's assignments never reaches the browser at all
 * — not hidden by CSS, simply absent from the payload.
 */
import Link from "next/link";
import { Building2, Plus, DoorOpen, BedDouble, Gauge, DoorClosed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { can } from "@/lib/permissions";
import type { SessionClaims } from "@/lib/auth/claims";
import type { PropertyOverviewItem } from "../queries";
import { OccupancyBar, OccupancyCounts } from "./occupancy-bar";
import { RealtimeOccupancy } from "./realtime-occupancy";

export function PropertyOverview({
  properties,
  user,
}: {
  properties: PropertyOverviewItem[];
  user: SessionClaims;
}) {
  // Creating a property is org-scoped (see actions.ts) — only offer it to a
  // caller who could actually complete it.
  const mayCreate = can(user, "property:manage") && user.propertyScope.kind === "ALL_IN_ORG";

  // Portfolio room roll-up (live, current-status) across the caller's scope.
  const totalRooms = properties.reduce((s, p) => s + p.occupancy.total, 0);
  const occupied = properties.reduce((s, p) => s + p.occupancy.occupied, 0);
  const vacant = properties.reduce((s, p) => s + p.occupancy.vacant, 0);
  const sellable = properties.reduce((s, p) => s + p.occupancy.availableForOccupancy, 0);
  const occPct = sellable > 0 ? Math.round((occupied / sellable) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* FR-7/AC-7: tiles update on RoomStatusChanged without a manual refresh. */}
      <RealtimeOccupancy />

      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Properties</h1>
          <p className="text-sm text-muted-foreground">
            {properties.length} propert{properties.length === 1 ? "y" : "ies"} in your scope
          </p>
        </div>
        {mayCreate && (
          <Button asChild size="sm">
            <Link href="/properties/new">
              <Plus className="size-4" />
              Add
            </Link>
          </Button>
        )}
      </div>

      {properties.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
          <KpiCard label="Properties" value={properties.length} icon={<Building2 />} hint="in scope" />
          <KpiCard label="Total rooms" value={totalRooms} icon={<BedDouble />} hint="across portfolio" />
          <KpiCard label="Occupied now" value={occupied} icon={<DoorClosed />} hint="in-house" />
          <KpiCard label="Vacant now" value={vacant} icon={<DoorOpen />} hint="ready to sell" />
          <KpiCard label="Live occupancy" value={`${occPct}%`} icon={<Gauge />} hint="current status" />
        </div>
      )}

      {properties.length === 0 ? (
        <EmptyState mayCreate={mayCreate} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {properties.map((property) => (
            <li key={property.id}>
              <PropertyTile property={property} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PropertyTile({ property }: { property: PropertyOverviewItem }) {
  return (
    <Card className="transition-colors hover:border-primary/40">
      <CardContent className="p-4">
        <Link
          href={`/properties/${property.id}`}
          className="block min-h-touch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid={`property-tile-${property.code}`}
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{property.name}</p>
              <p className="text-xs text-muted-foreground">
                {property.code} · {property.city}
              </p>
            </div>
            <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </div>

          <OccupancyBar occupancy={property.occupancy} className="mb-2" />
          <OccupancyCounts occupancy={property.occupancy} />
        </Link>
      </CardContent>
    </Card>
  );
}

function EmptyState({ mayCreate }: { mayCreate: boolean }) {
  return (
    <Card>
      <CardContent className="p-8 text-center">
        <Building2 className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium">No properties yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {mayCreate
            ? "Add your first property to begin operations."
            : "No properties have been assigned to you. Ask an administrator."}
        </p>
        {mayCreate && (
          <Button asChild className="mt-4">
            <Link href="/properties/new">Add a property</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
