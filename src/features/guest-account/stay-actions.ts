"use server";
/**
 * In-room portal actions (Phase 4). A checked-in guest raises a service request
 * against THEIR OWN active stay — the reservation/room are resolved from the
 * session, never the client, so a guest can't attach a request to someone else's
 * stay. Emits `GuestRequestCreated` → the notifications consumer alerts the
 * department + reception.
 */
import { NotFoundError, DomainError, ErrorCode } from "@/lib/errors";
import { type Result, toResult } from "@/lib/result";
import { db } from "@/lib/db";
import { runWithSystemContext } from "@/lib/context";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { resolveGuestSession } from "@/lib/guest-auth";
import { guestRequestSchema } from "./schema";

export type GuestRequestCreatedResult = { requestId: string };

export async function createGuestRequest(raw: unknown): Promise<Result<GuestRequestCreatedResult>> {
  return toResult(async () => {
    const input = guestRequestSchema.parse(raw);

    const principal = await resolveGuestSession();
    if (!principal) throw new NotFoundError("Please sign in.");

    // Resolve the guest's OWN active stay (never a client-supplied id).
    const stay = await db.unscoped().reservation.findFirst({
      where: { guestId: principal.guestId, status: "IN_HOUSE" },
      orderBy: { checkInDate: "desc" },
      select: { id: true, propertyId: true, allocations: { take: 1, select: { roomId: true } } },
    });
    if (!stay) {
      throw new DomainError(ErrorCode.NOT_FOUND, undefined, {
        publicMessage: "You need to be checked in to raise a request.",
      });
    }
    const roomId = stay.allocations[0]?.roomId ?? null;

    const requestId = await runWithSystemContext(principal.orgId, () =>
      db.unscoped().$transaction(async (tx) => {
        const row = await tx.guestRequest.create({
          data: {
            orgId: principal.orgId,
            propertyId: stay.propertyId,
            reservationId: stay.id,
            roomId,
            guestId: principal.guestId,
            kind: input.kind,
            detail: input.detail,
          },
          select: { id: true },
        });
        await writeAudit(tx, {
          action: "guestrequest:create",
          entityType: "GuestRequest",
          entityId: row.id,
          propertyId: stay.propertyId,
          after: { kind: input.kind },
        });
        await emitEvent(tx, {
          type: "GuestRequestCreated",
          aggregateId: row.id,
          propertyId: stay.propertyId,
          payload: { kind: input.kind, propertyId: stay.propertyId, roomId, reservationId: stay.id },
        });
        return row.id;
      }),
    );

    return { requestId };
  });
}
