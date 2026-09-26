import type { Metadata } from "next";
import Link from "next/link";
import { Layers } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { roomBoard } from "@/features/rooms/queries";
import { propertyOverview } from "@/features/properties/queries";
import { RoomBoard } from "@/features/rooms/components/room-board";
import { PropertyChooserCards } from "@/features/platform/components/property-chooser-cards";
import { BackToAllProperties } from "@/features/platform/components/back-to-all-properties";
import { NoProperty } from "@/features/platform/components/no-property";

export const metadata: Metadata = { title: "Rooms" };

/**
 * 02 T-14 room board (FR-9, AC-10/11) with the client's property-first flow (#9):
 * "All hotels" → the 4 properties as cards (each with live room stats) → click one
 * → that property's room board. Switching from the top-bar selector works too.
 */
export default async function RoomsPage() {
  const user = await requirePermission("room:view-status");
  const propertyId = user.activePropertyId;

  // Default (all hotels): show the properties as cards to drill into.
  if (!propertyId) {
    const overview = await propertyOverview(user);
    if (overview.length === 0) {
      return <NoProperty what="Rooms" canCreate={can(user, "property:manage", null)} />;
    }
    return (
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-4">
          <h1 className="text-xl font-semibold tracking-tight">Rooms</h1>
          <p className="text-sm text-muted-foreground">Live room status across all properties. Choose a hotel to manage its rooms.</p>
        </div>
        <PropertyChooserCards
          what="rooms"
          properties={overview.map((p) => ({
            id: p.id,
            name: p.name,
            city: p.city,
            state: p.state,
            total: p.occupancy.total,
            occupied: p.occupancy.occupied,
            available: p.occupancy.vacant,
            maintenance: p.occupancy.maintenance,
            occupancyPct: Math.round(p.occupancy.occupancyBps / 100),
          }))}
        />
      </div>
    );
  }

  // Focused on one property: its room board.
  const board = await roomBoard(user, { propertyId });
  return (
    <div className="space-y-4">
      <BackToAllProperties />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Rooms</h1>
          <p className="text-sm text-muted-foreground">
            {board.total} room{board.total === 1 ? "" : "s"} · tap one for actions
          </p>
        </div>
        {can(user, "room:manage", propertyId) && (
          <Button asChild variant="outline" size="sm">
            <Link href="/rooms/categories">
              <Layers className="size-4" />
              Categories
            </Link>
          </Button>
        )}
      </div>

      <RoomBoard
        board={board}
        propertyId={propertyId}
        canBlock={can(user, "maintenance:manage", propertyId)}
        canManage={can(user, "room:manage", propertyId)}
      />
    </div>
  );
}
