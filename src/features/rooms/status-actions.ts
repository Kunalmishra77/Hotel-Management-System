"use server";

/**
 * Room status transitions — 02 T-8 (FR-4/5/6, AC-4/5/6/7/14).
 *
 * The single entry point for changing a room's status. Called by the board UI
 * and, internally, by 03 (reserve / check-in / check-out and the cancel and
 * no-show resets), 10 (cleaned) and 11 (maintenance).
 *
 * Two gates, in this order:
 *   1. the STATE MACHINE — is the edge legal at all? (FR-5)
 *   2. the ROLE — may this caller drive it? (AC-7)
 * Role gating narrows the machine and can never widen it, so an illegal edge
 * stays illegal for everyone.
 */
import { revalidatePath } from "next/cache";
import type { RoomStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { canTransition, canTransitionAsRole } from "./domain/transitions";
import { changeRoomStatusSchema } from "./schema";
import { ROOM_SELECT, rolesOf, roomDb, withRoomContext } from "./internal";

export type StatusChangeResult = {
  id: string;
  number: string;
  from: RoomStatus;
  to: RoomStatus;
};

export async function changeRoomStatus(input: unknown): Promise<Result<StatusChangeResult>> {
  return toResult(async () => {
    const data = changeRoomStatusSchema.parse(input);
    const user = await requireUser();

    const scoped = roomDb(user);
    const room = await scoped.room.findFirst({
      where: { id: data.roomId },
      select: { ...ROOM_SELECT },
    });
    if (!room) throw new NotFoundError("Room not found");

    // Everyone who touches a room board holds room:view-status; changing it
    // additionally needs the housekeeping permission or room:manage. The role
    // gate below is the finer-grained check.
    authorize(user, "room:view-status", room.propertyId);

    const from = room.status;
    const to = data.to as RoomStatus;

    // FR-5 / AC-6 — the edge itself.
    if (!canTransition(from, to)) {
      throw new ConflictError(
        `Room ${room.number} cannot go from ${describe(from)} to ${describe(to)}.`,
        { from, to },
      );
    }

    // AC-7 — may THIS caller drive it?
    if (!canTransitionAsRole(from, to, rolesOf(user))) {
      throw new ForbiddenError("Role may not perform this room status change", {
        from,
        to,
        userId: user.userId,
      });
    }

    return withRoomContext(user, () =>
      scoped.$transaction(async (tx) => {
        // Re-read inside the transaction and make the write conditional on the
        // status we validated. design.md § Edge cases allows "last transaction
        // wins", but the winner must still be making a LEGAL move — without
        // this, two concurrent changes could compose into an illegal one
        // (e.g. both read VACANT, one writes OCCUPIED, the other UNDER_MAINTENANCE).
        const applied = await tx.room.updateMany({
          where: { id: data.roomId, status: from },
          data: { status: to },
        });
        if (applied.count === 0) {
          throw new ConflictError(
            `Room ${room.number} changed status while you were working. Refresh and try again.`,
          );
        }

        await emitEvent(tx, {
          type: "RoomStatusChanged",
          aggregateId: data.roomId,
          propertyId: room.propertyId,
          // from/to per FR-6. No PII — the realtime channel forwards this.
          payload: { from, to, number: room.number },
        });
        await writeAudit(tx, {
          action: "room:change-status",
          entityType: "Room",
          entityId: data.roomId,
          propertyId: room.propertyId,
          reason: data.note ?? null,
          before: { status: from },
          after: { status: to },
        });

        revalidatePath("/rooms");
        revalidatePath("/properties");
        return { id: data.roomId, number: room.number, from, to };
      }),
    );
  });
}

/** Human-readable status for an error a receptionist has to act on. */
function describe(status: RoomStatus): string {
  switch (status) {
    case "VACANT":
      return "vacant";
    case "OCCUPIED":
      return "occupied";
    case "RESERVED":
      return "reserved";
    case "HOUSEKEEPING":
      return "housekeeping";
    case "UNDER_MAINTENANCE":
      return "under maintenance";
  }
}
