"use server";
/**
 * Room inspection action (architecture v2 · Phase 5). Records a post-clean
 * inspection: PASS marks the room VACANT (ready to sell); FAIL leaves it in
 * HOUSEKEEPING for a re-clean and captures defect notes. Canonical path:
 * validate → authorize (housekeeping:update, property-scoped) → tx → event + audit.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { db } from "@/lib/db";
import { runWithContext, newRequestId } from "@/lib/context";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { NotFoundError } from "@/lib/errors";
import { type Result, toResult } from "@/lib/result";
import { recordInspectionSchema } from "./schema";

export async function recordInspection(input: unknown): Promise<Result<{ status: string }>> {
  return toResult(async () => {
    const data = recordInspectionSchema.parse(input);
    const user = await requireUser();

    const room = await db.unscoped().room.findUnique({ where: { id: data.roomId }, select: { id: true, propertyId: true, status: true } });
    if (!room) throw new NotFoundError("Room not found.");
    authorize(user, "housekeeping:update", room.propertyId);

    const ctx = { orgId: user.orgId, userId: user.userId, propertyScope: user.propertyScope, activePropertyId: room.propertyId, requestId: newRequestId(), ip: null, device: null };
    const now = new Date();

    return runWithContext(ctx, () =>
      db.unscoped().$transaction(async (tx) => {
        await tx.roomInspection.create({
          data: {
            propertyId: room.propertyId,
            roomId: room.id,
            status: data.status,
            defectNotes: data.defectNotes ?? null,
            inspectedById: user.userId,
            inspectedAt: now,
          },
        });
        // PASS → the room is ready to sell; FAIL → keep it in housekeeping for a re-clean.
        if (data.status === "PASS" && room.status === "HOUSEKEEPING") {
          await tx.room.update({ where: { id: room.id }, data: { status: "VACANT" } });
        }
        await emitEvent(tx, { type: "RoomInspected", aggregateId: room.id, propertyId: room.propertyId, payload: { status: data.status } });
        await writeAudit(tx, { action: "room:inspect", entityType: "Room", entityId: room.id, propertyId: room.propertyId, after: { inspection: data.status } });
        return { status: data.status };
      }),
    );
  });
}
