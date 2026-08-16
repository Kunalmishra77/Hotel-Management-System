"use server";
/**
 * Reception → guest reply (architecture v2 · Phase 6). Staff replies into a
 * reservation's chat thread. Permission-checked (`request:manage`) + property-scoped
 * + audited; the guest sees the reply on their "My stay" page.
 */
import { NotFoundError } from "@/lib/errors";
import { type Result, toResult } from "@/lib/result";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { runWithContext, newRequestId } from "@/lib/context";

const replySchema = z.object({ reservationId: z.string().min(1), body: z.string().trim().min(1).max(1000) });

export async function replyToGuest(raw: unknown): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const data = replySchema.parse(raw);
    const user = await requireUser();

    const reservation = await db.unscoped().reservation.findUnique({
      where: { id: data.reservationId },
      select: { id: true, propertyId: true, guestId: true },
    });
    if (!reservation) throw new NotFoundError("Booking not found.");
    authorize(user, "request:manage", reservation.propertyId);

    const ctx = { orgId: user.orgId, userId: user.userId, propertyScope: user.propertyScope, activePropertyId: reservation.propertyId, requestId: newRequestId(), ip: null, device: null };

    const id = await runWithContext(ctx, () =>
      db.unscoped().$transaction(async (tx) => {
        const row = await tx.guestMessage.create({
          data: {
            orgId: user.orgId, propertyId: reservation.propertyId, reservationId: reservation.id,
            guestId: reservation.guestId, sender: "STAFF", senderUserId: user.userId, body: data.body,
          },
          select: { id: true },
        });
        await writeAudit(tx, { action: "guestmessage:reply", entityType: "GuestMessage", entityId: row.id, propertyId: reservation.propertyId, after: { sender: "STAFF" } });
        await emitEvent(tx, { type: "GuestMessageSent", aggregateId: row.id, propertyId: reservation.propertyId, payload: { sender: "STAFF", reservationId: reservation.id } });
        return row.id;
      }),
    );

    return { id };
  });
}
