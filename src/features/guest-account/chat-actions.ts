"use server";
/**
 * Guest → reception chat (architecture v2 · Phase 6). A checked-in guest messages
 * the front desk about THEIR OWN active stay — the reservation is resolved from the
 * session, never a client id, so a guest can't post into someone else's thread.
 */
import { NotFoundError, DomainError, ErrorCode } from "@/lib/errors";
import { type Result, toResult } from "@/lib/result";
import { db } from "@/lib/db";
import { runWithSystemContext } from "@/lib/context";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { resolveGuestSession } from "@/lib/guest-auth";
import { sendGuestMessageSchema } from "./schema";

export async function sendGuestMessage(raw: unknown): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const input = sendGuestMessageSchema.parse(raw);

    const principal = await resolveGuestSession();
    if (!principal) throw new NotFoundError("Please sign in.");

    const stay = await db.unscoped().reservation.findFirst({
      where: { guestId: principal.guestId, status: "IN_HOUSE" },
      orderBy: { checkInDate: "desc" },
      select: { id: true, propertyId: true },
    });
    if (!stay) {
      throw new DomainError(ErrorCode.NOT_FOUND, undefined, { publicMessage: "You need to be checked in to message the front desk." });
    }

    const id = await runWithSystemContext(principal.orgId, () =>
      db.unscoped().$transaction(async (tx) => {
        const row = await tx.guestMessage.create({
          data: {
            orgId: principal.orgId, propertyId: stay.propertyId, reservationId: stay.id,
            guestId: principal.guestId, sender: "GUEST", body: input.body,
          },
          select: { id: true },
        });
        await writeAudit(tx, { action: "guestmessage:send", entityType: "GuestMessage", entityId: row.id, propertyId: stay.propertyId, after: { sender: "GUEST" } });
        await emitEvent(tx, { type: "GuestMessageSent", aggregateId: row.id, propertyId: stay.propertyId, payload: { sender: "GUEST", reservationId: stay.id } });
        return row.id;
      }),
    );

    return { id };
  });
}
