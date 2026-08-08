"use server";

/**
 * Kitchen ticket lifecycle — 19 addendum (FR-24/25). Advance a ticket forward one
 * step at a time (QUEUED→PREPARING→READY→SERVED). Canonical write path: validate →
 * requireUser → authorize(pos:order-create on the ticket's property) → transaction →
 * emit KitchenTicketMoved → audit → Result. No money here.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { canAdvanceTicket, type TicketStatus } from "./domain/kitchen-ticket";
import { kitchenTicketMovedPayload } from "./events";
import { posDb, withPosContext } from "./internal";
import { ticketActionSchema } from "./schema";

type StampField = "startedAt" | "readyAt" | "servedAt";

async function advance(input: unknown, to: TicketStatus, stamp: StampField): Promise<Result<{ status: TicketStatus }>> {
  return toResult(async () => {
    const { ticketId } = ticketActionSchema.parse(input);
    const user = await requireUser();
    const client = posDb(user);
    const ticket = await client.kitchenTicket.findFirst({
      where: { id: ticketId },
      select: { id: true, propertyId: true, orderId: true, status: true },
    });
    if (!ticket) throw new NotFoundError("Kitchen ticket not found.");
    authorize(user, "pos:order-create", ticket.propertyId);
    if (!canAdvanceTicket(ticket.status as TicketStatus, to)) {
      throw new DomainError(ErrorCode.ILLEGAL_TICKET_TRANSITION);
    }

    await withPosContext(user, () =>
      client.$transaction(async (tx) => {
        // CAS on the current status so two concurrent advances can't double-move.
        const moved = await tx.kitchenTicket.updateMany({
          where: { id: ticketId, status: ticket.status as never },
          data: { status: to as never, [stamp]: new Date() },
        });
        if (moved.count !== 1) throw new DomainError(ErrorCode.ILLEGAL_TICKET_TRANSITION);
        await emitEvent(tx, {
          type: "KitchenTicketMoved",
          aggregateId: ticketId,
          propertyId: ticket.propertyId,
          payload: kitchenTicketMovedPayload({ ticketId, orderId: ticket.orderId, propertyId: ticket.propertyId, status: to }),
        });
        await writeAudit(tx, {
          action: "pos:kitchen-advance",
          entityType: "KitchenTicket",
          entityId: ticketId,
          propertyId: ticket.propertyId,
          before: { status: ticket.status },
          after: { status: to },
        });
      }),
    );
    return { status: to };
  });
}

export const startTicket = (input: unknown) => advance(input, "PREPARING", "startedAt");
export const readyTicket = (input: unknown) => advance(input, "READY", "readyAt");
export const serveTicket = (input: unknown) => advance(input, "SERVED", "servedAt");
