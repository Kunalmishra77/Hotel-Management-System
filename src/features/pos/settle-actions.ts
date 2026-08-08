"use server";

/**
 * POS settlement + void — 19 T-7/T-8/T-9/T-11 (FR-5/6/7/8/9/11/18). The money
 * crux: POS writes NO folio/payment/invoice row itself — it calls 06's public
 * actions and only stamps the order + emits its own domain event.
 *
 *  settleToFolio → billing.ensureFolio → billing.postFolioCharge (FolioLine, 06)
 *  settleDirect  → billing.settlePosSaleDirect (folio-less DIRECT_SALE, 06)
 *  voidOrder     → billing.reverseFolioLine (folio) / billing.voidInvoice (direct)
 *
 * Concurrency (FR-18) is a SAGA, not one long transaction — 06's actions open
 * their OWN transactions, so wrapping them in ours would hold a connection across
 * a nested transaction (deadlock risk under a pooler). Instead:
 *   1. CLAIM the transition in a short `SELECT … FOR UPDATE` tx (OPEN→SETTLED /
 *      SETTLED→VOID). Exactly one of two concurrent settlers claims it; the other
 *      reads the changed status and gets ORDER_NOT_OPEN — never a double post.
 *   2. Call 06 (its own tx). On failure, COMPENSATE (revert the claim) and reject.
 *   3. FINALIZE in a short tx: store refs, emit the domain event, audit.
 * Failure after a successful 06 call leaves the money correct (posted) and the
 * order in its new state — the least-bad direction.
 */
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import type { SessionClaims } from "@/lib/auth/claims";
import { ensureFolio, type FolioCapableTx } from "@/features/billing";
import { postFolioCharge, reverseFolioLine } from "@/features/billing/charge-actions";
import { settlePosSaleDirect } from "@/features/billing/pos-actions";
import { voidInvoice } from "@/features/billing/invoice-actions";
import { canTransition } from "./domain/state";
import { groupPosChargeLines } from "./domain/charge-lines";
import { posOrderSettledPayload, posOrderVoidedPayload, type SettledItem } from "./events";
import { posDb, withPosContext, lockOrder, POS_FOLIO_CHARGE_TYPE } from "./internal";
import { settleToFolioSchema, settleDirectSchema, voidOrderSchema } from "./schema";

type FullOrder = {
  id: string;
  code: string;
  propertyId: string;
  outletId: string;
  status: string;
  reservationId: string | null;
  subtotalPaise: number;
  discountPaise: number;
  totalPaise: number;
  settlementInvoiceId: string | null;
  items: { menuItemId: string | null; quantity: number; unitPaise: number; gstBps: number; hsnSac: string | null }[];
};

async function loadFull(client: ReturnType<typeof posDb>, orderId: string): Promise<FullOrder | null> {
  return client.posOrder.findFirst({
    where: { id: orderId },
    select: {
      id: true, code: true, propertyId: true, outletId: true, status: true, reservationId: true,
      subtotalPaise: true, discountPaise: true, totalPaise: true, settlementInvoiceId: true,
      items: { select: { menuItemId: true, quantity: true, unitPaise: true, gstBps: true, hsnSac: true } },
    },
  });
}

/** The consumption payload 20 deducts stock from — menu lines only (FR-9). */
function settledItems(order: FullOrder): SettledItem[] {
  return order.items
    .filter((i): i is FullOrder["items"][number] & { menuItemId: string } => i.menuItemId != null)
    .map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity }));
}

/** The net, pre-tax taxable value POS asks 06 to charge (subtotal − discount). */
function netTaxable(order: FullOrder): number {
  const net = order.subtotalPaise - order.discountPaise;
  if (net <= 0) throw new DomainError(ErrorCode.VALIDATION_FAILED, "Order has no positive taxable value to settle.");
  return net;
}

/**
 * CLAIM a status transition under a row lock (FR-18). Returns true iff this caller
 * won the claim; false means a concurrent caller already changed the status.
 */
async function claimTransition(
  client: ReturnType<typeof posDb>,
  user: SessionClaims,
  orderId: string,
  propertyId: string,
  from: string,
  to: string,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  return withPosContext(user, () =>
    client.$transaction(async (tx) => {
      const locked = await lockOrder(tx as unknown as Prisma.TransactionClient, orderId, propertyId);
      if (!locked || locked.status !== from) return false;
      await tx.posOrder.updateMany({ where: { id: orderId }, data: { status: to as never, ...extra } });
      return true;
    }),
  );
}

/** Revert a claimed status (compensation when the 06 call fails). */
async function revertStatus(
  client: ReturnType<typeof posDb>,
  orderId: string,
  to: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await client.posOrder.updateMany({ where: { id: orderId }, data: { status: to as never, ...extra } });
}

/**
 * Settle an OPEN order for an IN_HOUSE guest to its reservation folio (FR-5/7/8).
 * POS posts NO folio row — 06's `postFolioCharge` appends the FolioLine.
 */
export async function settleToFolio(input: unknown): Promise<Result<{ folioId: string; lineId: string }>> {
  return toResult(async () => {
    const { orderId } = settleToFolioSchema.parse(input);
    const user = await requireUser();
    const client = posDb(user);
    const order = await loadFull(client, orderId);
    if (!order) throw new NotFoundError("Order not found.");
    authorize(user, "pos:order-settle", order.propertyId);
    if (order.status !== "OPEN") throw new DomainError(ErrorCode.ORDER_NOT_OPEN);

    // FR-7 / AC-6: the folio target must be a genuine in-house reservation.
    if (!order.reservationId) throw new DomainError(ErrorCode.FOLIO_TARGET_INVALID);
    const reservation = await client.reservation.findFirst({ where: { id: order.reservationId, propertyId: order.propertyId }, select: { status: true } });
    if (!reservation || reservation.status !== "IN_HOUSE") throw new DomainError(ErrorCode.FOLIO_TARGET_INVALID);

    // Idempotent folio (committed BEFORE the charge so 06's own tx can see it).
    const folioId = await withPosContext(user, () =>
      client.$transaction((tx) => ensureFolio(tx as unknown as FolioCapableTx, { reservationId: order.reservationId!, propertyId: order.propertyId })),
    );
    const folio = await client.folio.findFirst({ where: { id: folioId }, select: { isClosed: true } });
    if (!folio || folio.isClosed) throw new DomainError(ErrorCode.FOLIO_TARGET_INVALID);

    netTaxable(order); // guard: must have a positive taxable value to settle
    // R-35: one folio line PER GST rate-group (the order may mix 5%/18%), each at
    // its true rate — never one lump line at a single rate. Same grouping the
    // guest's bill preview used, so the folio matches it exactly.
    const groups = groupPosChargeLines(order.items, order.discountPaise);

    // 1 · CLAIM OPEN→SETTLED (exactly one concurrent settler wins).
    const claimed = await claimTransition(client, user, orderId, order.propertyId, "OPEN", "SETTLED", { settledAt: new Date(), settledById: user.userId });
    if (!claimed) throw new DomainError(ErrorCode.ORDER_NOT_OPEN);

    // 2 · Post one FolioLine per rate-group via 06 (each its own tx). All share
    // the `POS <code>` description so void can find them. On a partial failure,
    // reverse what posted and revert the claim, so the order is cleanly re-settleable.
    const postedLineIds: string[] = [];
    for (const g of groups) {
      const charge = await postFolioCharge({
        folioId,
        type: POS_FOLIO_CHARGE_TYPE,
        description: `POS ${order.code}`,
        unitPaise: g.taxablePaise,
        quantity: 1,
        taxRateBps: g.gstBps,
        ...(g.hsnSac ? { hsnSac: g.hsnSac } : {}),
      });
      if (!charge.ok) {
        for (const lineId of postedLineIds) await reverseFolioLine({ lineId, reason: `POS ${order.code} settle rollback` });
        await revertStatus(client, orderId, "OPEN", { settledAt: null, settledById: null });
        throw new DomainError(charge.error.code as ErrorCode, charge.error.message);
      }
      postedLineIds.push(charge.data.lineId);
    }

    // 3 · FINALIZE: emit the settlement event (drives 20 stock) + audit.
    await withPosContext(user, () =>
      client.$transaction(async (tx) => {
        await emitEvent(tx, {
          type: "PosOrderSettled",
          aggregateId: orderId,
          propertyId: order.propertyId,
          payload: posOrderSettledPayload({ orderId, code: order.code, propertyId: order.propertyId, outletId: order.outletId, reservationId: order.reservationId, settlement: "FOLIO", totalPaise: order.totalPaise, items: settledItems(order) }),
        });
        await writeAudit(tx, { action: "pos:order-settle", entityType: "PosOrder", entityId: orderId, propertyId: order.propertyId, after: { settlement: "FOLIO", folioId, lines: postedLineIds.length } });
      }),
    );
    return { folioId, lineId: postedLineIds[0]! };
  });
}

/**
 * Settle an OPEN order directly (walk-in / takeaway) via 06's folio-less path
 * (FR-6). 06 uses `ensureDirectSaleFolio` (kind=DIRECT_SALE), records the payment
 * and issues a GST sale document; POS stores the returned refs.
 */
export async function settleDirect(input: unknown): Promise<Result<{ invoiceId: string; paymentId: string }>> {
  return toResult(async () => {
    const data = settleDirectSchema.parse(input);
    const user = await requireUser();
    const client = posDb(user);
    const order = await loadFull(client, data.orderId);
    if (!order) throw new NotFoundError("Order not found.");
    authorize(user, "pos:order-settle", order.propertyId);
    if (order.status !== "OPEN") throw new DomainError(ErrorCode.ORDER_NOT_OPEN);
    const taxable = netTaxable(order);

    // 1 · CLAIM OPEN→SETTLED.
    const claimed = await claimTransition(client, user, data.orderId, order.propertyId, "OPEN", "SETTLED", { settledAt: new Date(), settledById: user.userId });
    if (!claimed) throw new DomainError(ErrorCode.ORDER_NOT_OPEN);

    // 2 · Settle via 06's direct path. Compensate on failure.
    const sale = await settlePosSaleDirect({
      propertyId: order.propertyId,
      customerName: data.customerName,
      ...(data.customerGstin ? { customerGstin: data.customerGstin } : {}),
      items: [{ type: POS_FOLIO_CHARGE_TYPE, description: `POS ${order.code}`, unitPaise: taxable, quantity: 1 }],
      tender: { mode: data.tender.mode, amountPaise: data.tender.amountPaise ?? order.totalPaise },
    });
    if (!sale.ok) {
      await revertStatus(client, data.orderId, "OPEN", { settledAt: null, settledById: null });
      throw new DomainError(sale.error.code as ErrorCode, sale.error.message);
    }

    // 3 · FINALIZE: store the refs, emit, audit.
    await withPosContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.posOrder.updateMany({ where: { id: data.orderId }, data: { settlementInvoiceId: sale.data.invoiceId, settlementPaymentId: sale.data.paymentId } });
        await emitEvent(tx, {
          type: "PosOrderSettled",
          aggregateId: data.orderId,
          propertyId: order.propertyId,
          payload: posOrderSettledPayload({ orderId: data.orderId, code: order.code, propertyId: order.propertyId, outletId: order.outletId, reservationId: null, settlement: "DIRECT", totalPaise: order.totalPaise, items: settledItems(order) }),
        });
        await writeAudit(tx, { action: "pos:order-settle", entityType: "PosOrder", entityId: data.orderId, propertyId: order.propertyId, after: { settlement: "DIRECT", invoiceId: sale.data.invoiceId } });
      }),
    );
    return { invoiceId: sale.data.invoiceId, paymentId: sale.data.paymentId };
  });
}

/**
 * Void a SETTLED order (FR-11, AC-10). 🔒 `pos:order-void` + reason. Append-only:
 * the folio path calls 06's `reverseFolioLine` (a REVERSAL line); the direct path
 * calls 06's `voidInvoice` (a CREDIT_NOTE). Nothing is edited or deleted.
 */
export async function voidOrder(input: unknown): Promise<Result<{ ok: true }>> {
  return toResult(async () => {
    const data = voidOrderSchema.parse(input);
    const user = await requireUser();
    const client = posDb(user);
    const order = await loadFull(client, data.orderId);
    if (!order) throw new NotFoundError("Order not found.");
    authorize(user, "pos:order-void", order.propertyId, { reason: data.reason });
    if (!canTransition(order.status as never, "VOID")) throw new DomainError(ErrorCode.ILLEGAL_TRANSITION);

    const isDirect = order.settlementInvoiceId != null;

    // Resolve the folio REVERSAL targets (folio path) — ALL lines for this order
    // (R-35: a mixed-rate settle posts one line per rate, so there may be several).
    let reversalLineIds: string[] = [];
    if (!isDirect) {
      if (!order.reservationId) throw new DomainError(ErrorCode.ILLEGAL_TRANSITION, "No settlement to reverse.");
      const folio = await client.folio.findFirst({ where: { reservationId: order.reservationId }, select: { id: true } });
      if (!folio) throw new NotFoundError("Settlement folio not found.");
      const lines = await client.folioLine.findMany({
        where: { folioId: folio.id, type: POS_FOLIO_CHARGE_TYPE, description: `POS ${order.code}`, reversalOfId: null },
        select: { id: true },
      });
      if (lines.length === 0) throw new NotFoundError("Settlement line not found.");
      reversalLineIds = lines.map((l) => l.id);
    }

    // 1 · CLAIM SETTLED→VOID.
    const claimed = await claimTransition(client, user, data.orderId, order.propertyId, "SETTLED", "VOID");
    if (!claimed) throw new DomainError(ErrorCode.ILLEGAL_TRANSITION);

    // 2 · Reverse via 06. Compensate (back to SETTLED) on failure.
    if (isDirect) {
      const reversal = await voidInvoice({ invoiceId: order.settlementInvoiceId!, reason: data.reason });
      if (!reversal.ok) {
        await revertStatus(client, data.orderId, "SETTLED");
        throw new DomainError(reversal.error.code as ErrorCode, reversal.error.message);
      }
    } else {
      for (const lineId of reversalLineIds) {
        const reversal = await reverseFolioLine({ lineId, reason: data.reason });
        if (!reversal.ok) {
          await revertStatus(client, data.orderId, "SETTLED");
          throw new DomainError(reversal.error.code as ErrorCode, reversal.error.message);
        }
      }
    }

    // 3 · FINALIZE: emit + audit.
    await withPosContext(user, () =>
      client.$transaction(async (tx) => {
        await emitEvent(tx, { type: "PosOrderVoided", aggregateId: data.orderId, propertyId: order.propertyId, payload: posOrderVoidedPayload({ orderId: data.orderId, code: order.code, propertyId: order.propertyId, reason: data.reason, settlement: isDirect ? "DIRECT" : "FOLIO" }) });
        await writeAudit(tx, { action: "pos:order-void", entityType: "PosOrder", entityId: data.orderId, propertyId: order.propertyId, reason: data.reason, before: { status: "SETTLED" }, after: { status: "VOID" } });
      }),
    );
    return { ok: true as const };
  });
}
