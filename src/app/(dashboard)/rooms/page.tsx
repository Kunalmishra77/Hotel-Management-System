import type { Metadata } from "next";
import Link from "next/link";
import { Layers } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { roomBoard } from "@/features/rooms/queries";
import { RoomBoard } from "@/features/rooms/components/room-board";

export const metadata: Metadata = { title: "Rooms" };

/** 02 T-14 — the room board (FR-9, AC-10/AC-11). */
export default async function RoomsPage() {
  const user = await requirePermission("room:view-status");

  // The board is per-property; use the switched active property (00 FR-27).
  const propertyId = db.activeProperty(user);
  const board = await roomBoard(user, { propertyId });

  return (
    <div className="space-y-4">
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
