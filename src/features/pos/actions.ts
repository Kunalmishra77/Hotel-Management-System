"use server";

/**
 * POS order-lifecycle actions — 19 T-6/T-12/T-13 (FR-1/2/3/12/13/15/16). Canonical
 * write path: zod.parse → requireUser → authorize(pos:*) → transaction → (event) →
 * audit → typed Result. All money stays in 06; while an order is OPEN nothing is
 * posted — these actions only shape the order and its DERIVED preview.
 *
 * Settlement + void live in `settle-actions.ts`.
 */
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { authorize, hasPermission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { billPreview, type BillLine } from "./domain/bill-preview";
import { aggregatePrep } from "./domain/kot";
import { kitchenTicketMovedPayload } from "./events";
import { isEditable } from "./domain/state";
import { posDb, withPosContext, allocateOrderCode } from "./internal";
import {
  createOrderSchema,
  addItemSchema,
  removeItemSchema,
  applyDiscountSchema,
  sendToKitchenSchema,
} from "./schema";

type Ctx = { propertyId: string; propertyState: string; status: string; reservationId: string | null };

/** Load an order's property + state + status (scoped). Null when out of scope/missing. */
async function loadOrderCtx(client: ReturnType<typeof posDb>, orderId: string): Promise<Ctx | null> {
  const order = await client.posOrder.findFirst({
    where: { id: orderId },
    select: { propertyId: true, status: true, reservationId: true },
  });
  if (!order) return null;
  const property = await client.property.findFirst({ where: { id: order.propertyId }, select: { state: true } });
  return {
    propertyId: order.propertyId,
    propertyState: property?.state ?? "",
    status: order.status,
    reservationId: order.reservationId,
  };
}

/** Recompute the DERIVED preview from the order's lines + discount and persist it. */
async function recomputePreview(tx: Prisma.TransactionClient, orderId: string, propertyState: string): Promise<void> {
  const order = await tx.posOrder.findFirstOrThrow({
    where: { id: orderId },
    select: { discountPaise: true, items: { select: { quantity: true, unitPaise: true, gstBps: true } } },
  });
  const lines: BillLine[] = order.items.map((i) => ({ quantity: i.quantity, unitPaise: i.unitPaise, gstBps: i.gstBps }));
  const bill = billPreview(lines, order.discountPaise, propertyState);
  await tx.posOrder.updateMany({
    where: { id: orderId },
    data: {
      subtotalPaise: bill.subtotalPaise,
      discountPaise: bill.discountPaise,
      cgstPaise: bill.cgstPaise,
      sgstPaise: bill.sgstPaise,
      igstPaise: bill.igstPaise,
      roundOffPaise: bill.roundOffPaise,
      totalPaise: bill.totalPaise,
    },
  });
}

/** Guard: the order must be OPEN to accept edits (FR-10). */
function assertEditable(ctx: Ctx): void {
  if (!isEditable(ctx.status as never)) throw new DomainError(ErrorCode.ORDER_NOT_OPEN);
}

/** Open a new order at an outlet, optionally linked to an in-house reservation (FR-1). */
export async function createOrder(input: unknown): Promise<Result<{ id: string; code: string }>> {
  return toResult(async () => {
    const data = createOrderSchema.parse(input);
    const user = await requireUser();
    const client = posDb(user);

    const outlet = await client.posOutlet.findFirst({ where: { id: data.outletId }, select: { propertyId: true } });
    if (!outlet) throw new NotFoundError("Outlet not found.");
    authorize(user, "pos:order-create", outlet.propertyId);

    if (data.reservationId) {
      const reservation = await client.reservation.findFirst({
        where: { id: data.reservationId, propertyId: outlet.propertyId },
        select: { id: true },
      });
      if (!reservation) throw new DomainError(ErrorCode.FOLIO_TARGET_INVALID, "Reservation not found for this property.");
    }

    return withPosContext(user, () =>
      client.$transaction(async (tx) => {
        const { code } = await allocateOrderCode(tx as unknown as Prisma.TransactionClient, outlet.propertyId);
        const order = await tx.posOrder.create({
          data: {
            propertyId: outlet.propertyId,
            outletId: data.outletId,
            code,
            reservationId: data.reservationId ?? null,
            status: "OPEN",
          },
          select: { id: true, code: true },
        });
        await writeAudit(tx, { action: "pos:order-create", entityType: "PosOrder", entityId: order.id, propertyId: outlet.propertyId, after: { code, outletId: data.outletId } });
        return order;
      }),
    );
  });
}

/** Add a line to an OPEN order; menu items resolve their name/rate/HSN/GST (FR-2/3/4/16). */
export async function addItem(input: unknown): Promise<Result<{ itemId: string }>> {
  return toResult(async () => {
    const data = addItemSchema.parse(input);
    const user = await requireUser();
    const client = posDb(user);
    const ctx = await loadOrderCtx(client, data.orderId);
    if (!ctx) throw new NotFoundError("Order not found.");
    authorize(user, "pos:order-create", ctx.propertyId);
    assertEditable(ctx);

    // Resolve the line from the menu (config-driven rate/HSN/GST) or a custom line.
    let name = data.name ?? "";
    let unitPaise = data.unitPaise ?? 0;
    let hsnSac = data.hsnSac ?? null;
    let gstBps = data.gstBps ?? 0;
    if (data.menuItemId) {
      const menuItem = await client.menuItem.findFirst({
        where: { id: data.menuItemId, propertyId: ctx.propertyId },
        select: { name: true, ratePaise: true, hsnSac: true, gstBps: true },
      });
      if (!menuItem) throw new NotFoundError("Menu item not found.");
      name = menuItem.name;
      unitPaise = menuItem.ratePaise;
      hsnSac = menuItem.hsnSac;
      gstBps = menuItem.gstBps;
    }
    if (unitPaise < 0 || data.quantity <= 0) throw new DomainError(ErrorCode.VALIDATION_FAILED);

    return withPosContext(user, () =>
      client.$transaction(async (tx) => {
        const item = await tx.posOrderItem.create({
          data: {
            orderId: data.orderId,
            menuItemId: data.menuItemId ?? null,
            name,
            quantity: data.quantity,
            unitPaise,
            amountPaise: data.quantity * unitPaise,
            hsnSac,
            gstBps,
          },
          select: { id: true },
        });
        await recomputePreview(tx as unknown as Prisma.TransactionClient, data.orderId, ctx.propertyState);
        await writeAudit(tx, { action: "pos:item-add", entityType: "PosOrder", entityId: data.orderId, propertyId: ctx.propertyId, after: { name, quantity: data.quantity, unitPaise } });
        return { itemId: item.id };
      }),
    );
  });
}

/** Remove a line from an OPEN order and recompute the preview (FR-3). */
export async function removeItem(input: unknown): Promise<Result<{ ok: true }>> {
  return toResult(async () => {
    const data = removeItemSchema.parse(input);
    const user = await requireUser();
    const client = posDb(user);
    const ctx = await loadOrderCtx(client, data.orderId);
    if (!ctx) throw new NotFoundError("Order not found.");
    authorize(user, "pos:order-create", ctx.propertyId);
    assertEditable(ctx);

    return withPosContext(user, () =>
      client.$transaction(async (tx) => {
        const deleted = await tx.posOrderItem.deleteMany({ where: { id: data.itemId, orderId: data.orderId } });
        if (deleted.count === 0) throw new NotFoundError("Item not found on this order.");
        await recomputePreview(tx as unknown as Prisma.TransactionClient, data.orderId, ctx.propertyState);
        await writeAudit(tx, { action: "pos:item-remove", entityType: "PosOrder", entityId: data.orderId, propertyId: ctx.propertyId, after: { itemId: data.itemId } });
        return { ok: true as const };
      }),
    );
  });
}

/**
 * Apply a pre-tax, order-level discount (FR-15, AC-11). Over the org threshold it
 * requires `folio:discount` and writes an audited override — discount authority
 * stays in one place (mirrors 03/06).
 */
export async function applyDiscount(input: unknown): Promise<Result<{ discountPaise: number }>> {
  return toResult(async () => {
    const data = applyDiscountSchema.parse(input);
    const user = await requireUser();
    const client = posDb(user);
    const ctx = await loadOrderCtx(client, data.orderId);
    if (!ctx) throw new NotFoundError("Order not found.");
    authorize(user, "pos:order-create", ctx.propertyId);
    assertEditable(ctx);

    const settings = await client.securitySettings.findFirst({ where: { orgId: user.orgId }, select: { discountThresholdPaise: true } });
    const threshold = settings?.discountThresholdPaise ?? 100_000;
    const overThreshold = data.amountPaise > threshold;
    if (overThreshold && !hasPermission(user, "folio:discount")) {
      throw new DomainError(ErrorCode.DISCOUNT_OVER_THRESHOLD);
    }

    return withPosContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.posOrder.updateMany({ where: { id: data.orderId }, data: { discountPaise: data.amountPaise } });
        await recomputePreview(tx as unknown as Prisma.TransactionClient, data.orderId, ctx.propertyState);
        await writeAudit(tx, {
          action: overThreshold ? "pos:discount-override" : "pos:discount",
          entityType: "PosOrder",
          entityId: data.orderId,
          propertyId: ctx.propertyId,
          reason: data.reason,
          after: { discountPaise: data.amountPaise, override: overThreshold },
        });
        return { discountPaise: data.amountPaise };
      }),
    );
  });
}

/**
 * Send an OPEN order to the kitchen (KOT) WITHOUT settling (FR-13, AC-12). No
 * status change (the enum has no KOT state) and no money — it records the ticket
 * and returns the aggregated prep list for this order.
 */
export async function sendToKitchen(input: unknown): Promise<Result<{ prep: { name: string; quantity: number }[] }>> {
  return toResult(async () => {
    const data = sendToKitchenSchema.parse(input);
    const user = await requireUser();
    const client = posDb(user);
    const ctx = await loadOrderCtx(client, data.orderId);
    if (!ctx) throw new NotFoundError("Order not found.");
    authorize(user, "pos:order-create", ctx.propertyId);
    assertEditable(ctx);

    const order = await client.posOrder.findFirstOrThrow({
      where: { id: data.orderId },
      select: { outletId: true, items: { select: { name: true, menuItemId: true, quantity: true } } },
    });
    const prep = aggregatePrep(order.items).map((p) => ({ name: p.name, quantity: p.quantity }));

    await withPosContext(user, () =>
      client.$transaction(async (tx) => {
        // 19 addendum: create the kitchen ticket (idempotent — one per order).
        const ticket = await tx.kitchenTicket.upsert({
          where: { orderId: data.orderId },
          create: { orderId: data.orderId, propertyId: ctx.propertyId, outletId: order.outletId, status: "QUEUED", queuedAt: new Date() },
          update: {},
          select: { id: true, status: true },
        });
        // Only announce a freshly-queued ticket (a repeat KOT is a no-op for the board).
        if (ticket.status === "QUEUED") {
          await emitEvent(tx, {
            type: "KitchenTicketMoved",
            aggregateId: ticket.id,
            propertyId: ctx.propertyId,
            payload: kitchenTicketMovedPayload({ ticketId: ticket.id, orderId: data.orderId, propertyId: ctx.propertyId, status: "QUEUED" }),
          });
        }
        await writeAudit(tx, { action: "pos:kot", entityType: "PosOrder", entityId: data.orderId, propertyId: ctx.propertyId, after: { items: prep.length, ticketId: ticket.id } });
      }),
    );
    return { prep };
  });
}
