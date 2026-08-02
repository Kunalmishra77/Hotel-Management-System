"use server";

/**
 * Room blocks — 02 T-9 (FR-7, AC-8/AC-9).
 *
 * A `RoomBlock` removes a room from availability for a DATE RANGE, independently
 * of its live status. `11.blockRoom` calls this; `03` reads the rows when
 * computing availability ("Availability = allocations + blocks").
 *
 * Blocking deliberately does NOT change the room's status (design.md): status
 * is the board colour for *right now*, a block is about *future nights*. A
 * maintenance job that also takes the room out of service today calls
 * `changeRoomStatus` separately.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { blocksOverlapping } from "./domain/blocks";
import { blockRoomSchema, unblockRoomSchema } from "./schema";
import { roomDb, withRoomContext } from "./internal";

export type BlockSummary = {
  id: string;
  roomId: string;
  startDate: Date;
  endDate: Date;
  reason: string;
};

/** Block a room for a half-open date range [startDate, endDate). */
export async function blockRoom(input: unknown): Promise<Result<BlockSummary>> {
  return toResult(async () => {
    const data = blockRoomSchema.parse(input);
    const user = await requireUser();

    const scoped = roomDb(user);
    const room = await scoped.room.findFirst({
      where: { id: data.roomId },
      select: { propertyId: true, number: true },
    });
    if (!room) throw new NotFoundError("Room not found");

    authorize(user, "maintenance:manage", room.propertyId);

    return withRoomContext(user, () =>
      scoped.$transaction(async (tx) => {
        // Reject a block that overlaps an existing one. Two overlapping blocks
        // are not wrong for availability (either alone excludes the room) but
        // they make "when does this room come back?" unanswerable, and
        // unblocking one would silently leave the other in force.
        const existing = await tx.roomBlock.findMany({
          where: { roomId: data.roomId },
          select: { id: true, startDate: true, endDate: true, reason: true },
        });
        const clashes = blocksOverlapping(existing, {
          startDate: data.startDate,
          endDate: data.endDate,
        });
        if (clashes.length > 0) {
          const clash = clashes[0]!;
          throw new ConflictError(
            `Room ${room.number} is already blocked from ` +
              `${clash.startDate.toISOString().slice(0, 10)} to ` +
              `${clash.endDate.toISOString().slice(0, 10)}.`,
          );
        }

        const block = await tx.roomBlock.create({
          data: {
            propertyId: room.propertyId,
            roomId: data.roomId,
            startDate: data.startDate,
            endDate: data.endDate,
            reason: data.reason,
            maintenanceJobId: data.maintenanceJobId ?? null,
          },
          select: { id: true, roomId: true, startDate: true, endDate: true, reason: true },
        });

        // No domain event: the catalogue has none for blocking, and 03 reads
        // the rows directly when computing availability. Still audited — taking
        // inventory out of sale is a decision someone must be able to trace.
        await writeAudit(tx, {
          action: "room:block",
          entityType: "RoomBlock",
          entityId: block.id,
          propertyId: room.propertyId,
          reason: data.reason,
          after: {
            roomId: data.roomId,
            startDate: block.startDate.toISOString().slice(0, 10),
            endDate: block.endDate.toISOString().slice(0, 10),
          },
        });

        revalidatePath("/rooms");
        return block;
      }),
    );
  });
}

/** Remove a block, returning the room to availability (AC-9). */
export async function unblockRoom(input: unknown): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const data = unblockRoomSchema.parse(input);
    const user = await requireUser();

    const scoped = roomDb(user);
    const block = await scoped.roomBlock.findFirst({
      where: { id: data.blockId },
      select: { id: true, propertyId: true, roomId: true, startDate: true, endDate: true },
    });
    if (!block) throw new NotFoundError("Block not found");

    authorize(user, "maintenance:manage", block.propertyId);

    return withRoomContext(user, () =>
      scoped.$transaction(async (tx) => {
        // deleteMany, not delete: the scope extension wraps the `where` into a
        // non-unique AND filter, which Prisma's unique-where `delete` rejects
        // (the D-3 footgun). The id filter still targets exactly one row.
        await tx.roomBlock.deleteMany({ where: { id: data.blockId } });

        await writeAudit(tx, {
          action: "room:unblock",
          entityType: "RoomBlock",
          entityId: data.blockId,
          propertyId: block.propertyId,
          before: {
            roomId: block.roomId,
            startDate: block.startDate.toISOString().slice(0, 10),
            endDate: block.endDate.toISOString().slice(0, 10),
          },
        });

        revalidatePath("/rooms");
        return { id: data.blockId };
      }),
    );
  });
}
