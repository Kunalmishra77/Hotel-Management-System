"use server";

/**
 * Guest QR ordering actions — 19 addendum (FR-21/22/23).
 *
 *  submitGuestOrder  — PUBLIC (no session): occupied-gated, server-priced, creates
 *                      a REQUESTED order. Nothing charged, nothing to the kitchen.
 *  acceptGuestOrder  — staff: REQUESTED→OPEN → sendToKitchen → existing settleToFolio.
 *  rejectGuestOrder  — staff: REQUESTED→VOID, nothing charged.
 *
 * The money path is reused verbatim (settleToFolio) — the REQUESTED gate is the
 * only thing this adds in front of it.
 */
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { db } from "@/lib/db";
import { billPreview } from "./domain/bill-preview";
import { guestOrderRequestedPayload, posOrderVoidedPayload } from "./events";
import { allocateOrderCode, posDb, withPosContext } from "./internal";
import { resolveRoomToken, withGuestContext, checkGuestSubmitRate } from "./guest-internal";
import { sendToKitchen } from "./actions";
import { settleToFolio } from "./settle-actions";
import { submitGuestOrderSchema, acceptGuestOrderSchema, rejectGuestOrderSchema } from "./schema";

/**
 * Guest submits an order from the in-room QR page (FR-21). Public: no auth. The
 * occupied-gate + token check is `resolveRoomToken`; lines are server-priced from
 * the outlet's active menu (client prices ignored; off-menu items rejected).
 */
export async function submitGuestOrder(input: unknown): Promise<Result<{ orderId: string }>> {
  return toResult(async () => {
    const data = submitGuestOrderSchema.parse(input);
    // Rate-limit BEFORE any DB work — the token is the only thing gating a public,
    // unauthenticated flood (FR-26).
    if (!checkGuestSubmitRate(data.token)) throw new DomainError(ErrorCode.RATE_LIMITED);
    const target = await resolveRoomToken(data.token);
    if (!target) throw new DomainError(ErrorCode.ROOM_NOT_AVAILABLE);

    const client = db.unscoped();
    const menuItems = await client.menuItem.findMany({
      where: { outletId: target.outletId, isActive: true, id: { in: data.lines.map((l) => l.menuItemId) } },
      select: { id: true, name: true, ratePaise: true, hsnSac: true, gstBps: true },
    });
    const byId = new Map(menuItems.map((m) => [m.id, m]));
    for (const l of data.lines) {
      if (!byId.has(l.menuItemId)) throw new DomainError(ErrorCode.VALIDATION_FAILED, "Item not on the menu.");
    }

    // Compute + store the DERIVED preview now, so a later accept→settleToFolio has
    // the correct taxable value (on-premise F&B → CGST+SGST, property state).
    const property = await client.property.findFirstOrThrow({ where: { id: target.propertyId }, select: { state: true } });
    const bill = billPreview(
      data.lines.map((l) => ({ quantity: l.quantity, unitPaise: byId.get(l.menuItemId)!.ratePaise, gstBps: byId.get(l.menuItemId)!.gstBps })),
      0,
      property.state,
    );

    return withGuestContext(target.orgId, target.propertyId, () =>
      client.$transaction(async (tx) => {
        const { code } = await allocateOrderCode(tx as unknown as Prisma.TransactionClient, target.propertyId);
        const order = await tx.posOrder.create({
          data: {
            propertyId: target.propertyId,
            outletId: target.outletId,
            code,
            reservationId: target.reservationId,
            status: "REQUESTED",
            source: "GUEST_QR",
            guestNote: data.note ?? null,
            subtotalPaise: bill.subtotalPaise,
            discountPaise: bill.discountPaise,
            cgstPaise: bill.cgstPaise,
            sgstPaise: bill.sgstPaise,
            igstPaise: bill.igstPaise,
            roundOffPaise: bill.roundOffPaise,
            totalPaise: bill.totalPaise,
            items: {
              create: data.lines.map((l) => {
                const m = byId.get(l.menuItemId)!;
                return { menuItemId: m.id, name: m.name, quantity: l.quantity, unitPaise: m.ratePaise, amountPaise: l.quantity * m.ratePaise, hsnSac: m.hsnSac, gstBps: m.gstBps };
              }),
            },
          },
          select: { id: true, code: true },
        });
        await emitEvent(tx, {
          type: "GuestOrderRequested",
          aggregateId: order.id,
          propertyId: target.propertyId,
          payload: guestOrderRequestedPayload({ orderId: order.id, code: order.code, propertyId: target.propertyId, roomNumber: target.roomNumber }),
        });
        await writeAudit(tx, {
          action: "pos:guest-order",
          entityType: "PosOrder",
          entityId: order.id,
          propertyId: target.propertyId,
          after: { source: "GUEST_QR", room: target.roomNumber, lines: data.lines.length },
        });
        return { orderId: order.id };
      }),
    );
  });
}

/** Load a REQUESTED order for the staff gate (scoped). */
async function loadRequested(client: ReturnType<typeof posDb>, orderId: string) {
  const order = await client.posOrder.findFirst({
    where: { id: orderId },
    select: { id: true, code: true, propertyId: true, status: true, reservationId: true },
  });
  return order;
}

/**
 * Compensate a failed accept: revert OPEN→REQUESTED and drop the kitchen ticket
 * created for this attempt, so the order returns to the inbox cleanly re-actionable
 * (never stranded OPEN — which the state machine can't void).
 */
async function compensateAccept(client: ReturnType<typeof posDb>, user: Awaited<ReturnType<typeof requireUser>>, orderId: string): Promise<void> {
  await withPosContext(user, () =>
    client.$transaction(async (tx) => {
      await tx.kitchenTicket.deleteMany({ where: { orderId } });
      await tx.posOrder.updateMany({ where: { id: orderId, status: "OPEN" as never }, data: { status: "REQUESTED" as never } });
    }),
  );
}

/**
 * Staff accept a REQUESTED guest order (FR-22): REQUESTED→OPEN under a row lock,
 * then send it to the kitchen and post it to the room folio via the EXISTING
 * settleToFolio. Returns the folio + line ids from that path.
 *
 * The guest is re-checked IN_HOUSE up front so a stale REQUESTED order (the guest
 * already checked out) fails fast — no claim, no kitchen ticket. If a later step
 * fails, `compensateAccept` reverts the order to REQUESTED so it is never stranded.
 */
export async function acceptGuestOrder(input: unknown): Promise<Result<{ folioId: string; lineId: string }>> {
  return toResult(async () => {
    const { orderId } = acceptGuestOrderSchema.parse(input);
    const user = await requireUser();
    const client = posDb(user);
    const order = await loadRequested(client, orderId);
    if (!order) throw new NotFoundError("Order not found.");
    authorize(user, "pos:order-create", order.propertyId);
    if (order.status !== "REQUESTED") throw new DomainError(ErrorCode.ORDER_NOT_REQUESTED);

    // Fail fast if the guest is no longer in-house (checked out while REQUESTED):
    // don't claim, don't send to the kitchen, don't strand an OPEN order.
    if (!order.reservationId) throw new DomainError(ErrorCode.FOLIO_TARGET_INVALID);
    const reservation = await client.reservation.findFirst({
      where: { id: order.reservationId, propertyId: order.propertyId },
      select: { status: true },
    });
    if (!reservation || reservation.status !== "IN_HOUSE") throw new DomainError(ErrorCode.FOLIO_TARGET_INVALID);

    // Claim REQUESTED→OPEN (CAS: exactly one accept wins).
    const claimed = await withPosContext(user, () =>
      client.$transaction(async (tx) => {
        const moved = await tx.posOrder.updateMany({ where: { id: orderId, status: "REQUESTED" as never }, data: { status: "OPEN" as never } });
        if (moved.count === 1) {
          await writeAudit(tx, { action: "pos:guest-accept", entityType: "PosOrder", entityId: orderId, propertyId: order.propertyId, before: { status: "REQUESTED" }, after: { status: "OPEN" } });
        }
        return moved.count === 1;
      }),
    );
    if (!claimed) throw new DomainError(ErrorCode.ORDER_NOT_REQUESTED);

    // Now an OPEN order: send to kitchen + settle to the room folio (reused path).
    // On any failure, compensate back to REQUESTED so it is never stranded OPEN.
    const kot = await sendToKitchen({ orderId });
    if (!kot.ok) {
      await compensateAccept(client, user, orderId);
      throw new DomainError(kot.error.code as ErrorCode, kot.error.message);
    }
    const settled = await settleToFolio({ orderId });
    if (!settled.ok) {
      await compensateAccept(client, user, orderId);
      throw new DomainError(settled.error.code as ErrorCode, settled.error.message);
    }
    return settled.data;
  });
}

/** Staff reject a REQUESTED guest order (FR-23): REQUESTED→VOID, nothing charged. */
export async function rejectGuestOrder(input: unknown): Promise<Result<{ ok: true }>> {
  return toResult(async () => {
    const { orderId, reason } = rejectGuestOrderSchema.parse(input);
    const user = await requireUser();
    const client = posDb(user);
    const order = await loadRequested(client, orderId);
    if (!order) throw new NotFoundError("Order not found.");
    authorize(user, "pos:order-void", order.propertyId, { reason });
    if (order.status !== "REQUESTED") throw new DomainError(ErrorCode.ORDER_NOT_REQUESTED);

    await withPosContext(user, () =>
      client.$transaction(async (tx) => {
        const moved = await tx.posOrder.updateMany({ where: { id: orderId, status: "REQUESTED" as never }, data: { status: "VOID" as never } });
        if (moved.count !== 1) throw new DomainError(ErrorCode.ORDER_NOT_REQUESTED);
        await emitEvent(tx, { type: "PosOrderVoided", aggregateId: orderId, propertyId: order.propertyId, payload: posOrderVoidedPayload({ orderId, code: order.code, propertyId: order.propertyId, reason, settlement: "NONE" }) });
        await writeAudit(tx, { action: "pos:guest-reject", entityType: "PosOrder", entityId: orderId, propertyId: order.propertyId, reason, before: { status: "REQUESTED" }, after: { status: "VOID" } });
      }),
    );
    return { ok: true as const };
  });
}
