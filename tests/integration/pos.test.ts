/**
 * 19 POS integration — the money crux verified end-to-end against a real DB with
 * 06 doing all the money. Auth mocked at the boundary (like billing.test.ts).
 *
 * Money rows (FolioLine/Payment/Invoice) are append-only (DB triggers block
 * DELETE), so this suite NEVER deletes them and creates fresh reservations with
 * unique codes/dates per run. Teardown only removes this module's own rows
 * (PosOrder/PosOrderItem/MenuItem/PosOutlet).
 */
import { vi } from "vitest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

const authMock = vi.hoisted(() => ({ current: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => {
    if (!authMock.current) throw new Error("no test user set");
    return authMock.current;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { PROP_A_ID, GUEST_MEHTA_ID, USER_RECEPTION_A_ID, USER_ACCOUNTS_ID, USER_HOUSEKEEPING_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { createOrder, addItem, removeItem, applyDiscount, sendToKitchen } from "@/features/pos/actions";
import { settleToFolio, settleDirect, voidOrder } from "@/features/pos/settle-actions";
import { getOrder, unsettledOrders } from "@/features/pos/queries";

const prisma = createPrismaClient();
const RUN = Date.now().toString(36);
const OUTLET_ID = `outlet_pos_${RUN}`;
const DOSA_ID = `menu_dosa_${RUN}`;
const COFFEE_ID = `menu_coffee_${RUN}`;
const BEER_ID = `menu_beer_${RUN}`; // 18% slab — for the mixed-rate (R-35) case

let resCounter = 0;

async function actAs(userId: string): Promise<SessionClaims> {
  const claims = await assembleClaims(prisma, userId);
  if (!claims) throw new Error(`no claims for ${userId}`);
  authMock.current = claims;
  return claims;
}

/** A fresh reservation with unique code + future dates (no allocation → no overlap). */
async function makeReservation(status: "IN_HOUSE" | "CONFIRMED"): Promise<string> {
  resCounter += 1;
  const base = 2035 + resCounter; // far-future, unique per reservation
  const r = await prisma.reservation.create({
    data: {
      propertyId: PROP_A_ID,
      code: `POS-RES-${RUN}-${resCounter}`,
      guestId: GUEST_MEHTA_ID,
      status,
      source: "WALK_IN",
      checkInDate: new Date(`${base}-01-10`),
      checkOutDate: new Date(`${base}-01-12`),
      nights: 2,
      ratePaise: 400_000,
    },
    select: { id: true },
  });
  return r.id;
}

async function openOrderWith(reservationId: string | undefined, items: { menuItemId: string; quantity: number }[]): Promise<string> {
  const created = await createOrder({ outletId: OUTLET_ID, reservationId });
  if (!created.ok) throw new Error(`createOrder failed: ${created.error.code}`);
  for (const it of items) {
    const added = await addItem({ orderId: created.data.id, menuItemId: it.menuItemId, quantity: it.quantity });
    if (!added.ok) throw new Error(`addItem failed: ${added.error.code}`);
  }
  return created.data.id;
}

beforeAll(async () => {
  await prisma.posOutlet.create({ data: { id: OUTLET_ID, propertyId: PROP_A_ID, name: `REST-${RUN}`, defaultGstBps: 500 } });
  await prisma.menuItem.createMany({
    data: [
      { id: DOSA_ID, propertyId: PROP_A_ID, outletId: OUTLET_ID, name: "Masala Dosa", ratePaise: 12_000, hsnSac: "996331", gstBps: 500 },
      { id: COFFEE_ID, propertyId: PROP_A_ID, outletId: OUTLET_ID, name: "Coffee", ratePaise: 6_000, hsnSac: "996331", gstBps: 500 },
      { id: BEER_ID, propertyId: PROP_A_ID, outletId: OUTLET_ID, name: "Beer", ratePaise: 20_000, hsnSac: "996311", gstBps: 1800 },
    ],
  });
});

beforeEach(() => { authMock.current = null; });

afterAll(async () => {
  await prisma.kitchenTicket.deleteMany({ where: { outletId: OUTLET_ID } });
  await prisma.posOrderItem.deleteMany({ where: { order: { outletId: OUTLET_ID } } });
  await prisma.posOrder.deleteMany({ where: { outletId: OUTLET_ID } });
  await prisma.menuItem.deleteMany({ where: { outletId: OUTLET_ID } });
  await prisma.posOutlet.deleteMany({ where: { id: OUTLET_ID } });
  await prisma.$disconnect();
});

describe("capture an order (T-6, FR-1/2/3/16, AC-1/2/4)", () => {
  it("creates an OPEN order with a gap-free code and a DERIVED subtotal (AC-1)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const orderId = await openOrderWith(undefined, [{ menuItemId: DOSA_ID, quantity: 2 }, { menuItemId: COFFEE_ID, quantity: 1 }]);
    const claims = await actAs(USER_RECEPTION_A_ID);
    const view = await getOrder(claims, orderId);
    expect(view?.status).toBe("OPEN");
    expect(view?.code).toMatch(/^POS-\d{6}$/);
    expect(view?.subtotalPaise).toBe(30_000); // 2×12,000 + 6,000 — never trusted from client
  });

  it("recomputes the bill preview: ₹300 @ 5% → CGST 750 + SGST 750, total ₹315 (AC-2/3)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const orderId = await openOrderWith(undefined, [{ menuItemId: DOSA_ID, quantity: 2 }, { menuItemId: COFFEE_ID, quantity: 1 }]);
    const claims = await actAs(USER_RECEPTION_A_ID);
    const view = await getOrder(claims, orderId);
    expect(view?.cgstPaise).toBe(750);
    expect(view?.sgstPaise).toBe(750);
    expect(view?.igstPaise).toBe(0);
    expect(view?.totalPaise).toBe(31_500);
  });

  it("removing an item recomputes the preview (AC-2)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const orderId = await openOrderWith(undefined, [{ menuItemId: DOSA_ID, quantity: 1 }]);
    const claims = await actAs(USER_RECEPTION_A_ID);
    const before = await getOrder(claims, orderId);
    await removeItem({ orderId, itemId: before!.items[0]!.id });
    const after = await getOrder(await actAs(USER_RECEPTION_A_ID), orderId);
    expect(after?.subtotalPaise).toBe(0);
  });

  it("rejects a zero-quantity line with VALIDATION_FAILED (AC-4)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const created = await createOrder({ outletId: OUTLET_ID });
    if (!created.ok) throw new Error("createOrder failed");
    const res = await addItem({ orderId: created.data.id, menuItemId: DOSA_ID, quantity: 0 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("allocates gap-free sequential codes per property (FR-1)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const a = await createOrder({ outletId: OUTLET_ID });
    const b = await createOrder({ outletId: OUTLET_ID });
    if (!a.ok || !b.ok) throw new Error("createOrder failed");
    const na = Number(a.data.code.split("-")[1]);
    const nb = Number(b.data.code.split("-")[1]);
    expect(nb - na).toBe(1);
  });
});

describe("settle to folio — in-house (T-7/T-8/T-10, FR-5/7/8/9, AC-5/6/8)", () => {
  it("posts a FolioLine via 06, marks SETTLED, emits PosOrderSettled (AC-5)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const reservationId = await makeReservation("IN_HOUSE");
    const orderId = await openOrderWith(reservationId, [{ menuItemId: DOSA_ID, quantity: 2 }, { menuItemId: COFFEE_ID, quantity: 1 }]);

    await actAs(USER_RECEPTION_A_ID);
    const res = await settleToFolio({ orderId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // 06 wrote the FolioLine (POS writes none itself): 5% F&B → CGST 750 + SGST 750.
    const line = await prisma.folioLine.findUniqueOrThrow({ where: { id: res.data.lineId } });
    expect(line.type).toBe("FOOD");
    expect(Number(line.amountPaise)).toBe(30_000);
    expect(line.cgstPaise).toBe(750);
    expect(line.sgstPaise).toBe(750);
    expect(line.igstPaise).toBe(0);
    expect(line.placeOfSupplyState).toBe("Karnataka");

    const order = await prisma.posOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("SETTLED");
    expect(order.settledById).toBe(USER_RECEPTION_A_ID);

    const event = await prisma.domainEvent.findFirst({ where: { type: "PosOrderSettled", aggregateId: orderId } });
    expect(event).not.toBeNull();
    // AC-8: the payload drives 20 stock deduction — carries {menuItemId, quantity}.
    const payload = event!.payload as { items: { menuItemId: string; quantity: number }[] };
    expect(payload.items).toEqual(expect.arrayContaining([{ menuItemId: DOSA_ID, quantity: 2 }, { menuItemId: COFFEE_ID, quantity: 1 }]));
  });

  it("rejects a non-in-house folio target with FOLIO_TARGET_INVALID (AC-6)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const reservationId = await makeReservation("CONFIRMED"); // not IN_HOUSE
    const orderId = await openOrderWith(reservationId, [{ menuItemId: DOSA_ID, quantity: 1 }]);
    await actAs(USER_RECEPTION_A_ID);
    const res = await settleToFolio({ orderId });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FOLIO_TARGET_INVALID");
    // Nothing posted; still OPEN.
    expect((await prisma.posOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("OPEN");
  });

  it("rejects a folio settle for a walk-in order (no reservation) with FOLIO_TARGET_INVALID (AC-6)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const orderId = await openOrderWith(undefined, [{ menuItemId: DOSA_ID, quantity: 1 }]);
    await actAs(USER_RECEPTION_A_ID);
    const res = await settleToFolio({ orderId });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FOLIO_TARGET_INVALID");
  });

  it("posts ONE folio line PER GST rate for a mixed-slab order, and voids all of them (R-35)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const reservationId = await makeReservation("IN_HOUSE");
    // 2× Dosa @5% (24000) + 1× Beer @18% (20000).
    const orderId = await openOrderWith(reservationId, [{ menuItemId: DOSA_ID, quantity: 2 }, { menuItemId: BEER_ID, quantity: 1 }]);

    await actAs(USER_RECEPTION_A_ID);
    const res = await settleToFolio({ orderId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const folio = await prisma.folio.findFirstOrThrow({ where: { reservationId } });
    const lines = await prisma.folioLine.findMany({
      where: { folioId: folio.id, description: `POS ${(await prisma.posOrder.findUniqueOrThrow({ where: { id: orderId } })).code}`, reversalOfId: null },
      orderBy: { taxRateBps: "asc" },
      select: { taxRateBps: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true },
    });
    expect(lines).toHaveLength(2);
    // 5% line: 24000 → CGST 600 + SGST 600.
    expect(lines[0]!.taxRateBps).toBe(500);
    expect(Number(lines[0]!.amountPaise)).toBe(24_000);
    expect(lines[0]!.cgstPaise).toBe(600);
    expect(lines[0]!.sgstPaise).toBe(600);
    // 18% line: 20000 → CGST 1800 + SGST 1800.
    expect(lines[1]!.taxRateBps).toBe(1800);
    expect(Number(lines[1]!.amountPaise)).toBe(20_000);
    expect(lines[1]!.cgstPaise).toBe(1800);
    expect(lines[1]!.sgstPaise).toBe(1800);
    expect(lines.every((l) => l.igstPaise === 0)).toBe(true);

    // Void reverses BOTH lines (two REVERSAL rows netting the charges to zero).
    await actAs(USER_ACCOUNTS_ID); // has pos:order-void
    const voided = await voidOrder({ orderId, reason: "mixed-rate void" });
    expect(voided.ok).toBe(true);
    const reversals = await prisma.folioLine.count({ where: { folioId: folio.id, type: "REVERSAL" } });
    expect(reversals).toBe(2);
  });
});

describe("settle direct — walk-in (T-9, FR-6, AC-7)", () => {
  it("settles via 06's DIRECT_SALE path and stores invoice/payment refs", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const orderId = await openOrderWith(undefined, [{ menuItemId: DOSA_ID, quantity: 1 }]);
    await actAs(USER_RECEPTION_A_ID);
    const res = await settleDirect({ orderId, customerName: "Walk-in Guest", tender: { mode: "CASH" } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.invoiceId).toBeTruthy();
    expect(res.data.paymentId).toBeTruthy();

    const order = await prisma.posOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("SETTLED");
    expect(order.settlementInvoiceId).toBe(res.data.invoiceId);

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: res.data.invoiceId } });
    expect(invoice.number).toMatch(/WMG\/\d{4}-\d{2}\/\d{5}/);
    const folio = await prisma.folio.findUniqueOrThrow({ where: { id: invoice.folioId } });
    expect(folio.kind).toBe("DIRECT_SALE");
  });
});

describe("void & immutability (T-11, FR-10/11, AC-9/10)", () => {
  it("re-settling a SETTLED order is rejected (immutable, AC-9)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const reservationId = await makeReservation("IN_HOUSE");
    const orderId = await openOrderWith(reservationId, [{ menuItemId: DOSA_ID, quantity: 1 }]);
    await actAs(USER_RECEPTION_A_ID);
    expect((await settleToFolio({ orderId })).ok).toBe(true);
    const again = await settleToFolio({ orderId });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("ORDER_NOT_OPEN");
    // Adding an item to a SETTLED order is refused too.
    const add = await addItem({ orderId, menuItemId: COFFEE_ID, quantity: 1 });
    expect(add.ok).toBe(false);
  });

  it("void (folio path) appends a REVERSAL line and marks VOID (AC-10)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const reservationId = await makeReservation("IN_HOUSE");
    const orderId = await openOrderWith(reservationId, [{ menuItemId: DOSA_ID, quantity: 1 }]);
    await actAs(USER_RECEPTION_A_ID);
    const settle = await settleToFolio({ orderId });
    if (!settle.ok) throw new Error("settle failed");

    await actAs(USER_ACCOUNTS_ID); // pos:order-void (reception lacks it)
    const res = await voidOrder({ orderId, reason: "wrong table" });
    expect(res.ok).toBe(true);
    const reversal = await prisma.folioLine.findFirst({ where: { reversalOfId: settle.data.lineId } });
    expect(reversal?.type).toBe("REVERSAL");
    expect(Number(reversal?.amountPaise)).toBe(-12_000);
    expect((await prisma.posOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("VOID");
    expect(await prisma.domainEvent.findFirst({ where: { type: "PosOrderVoided", aggregateId: orderId } })).not.toBeNull();
  });

  it("void (direct path) issues a 06 CREDIT_NOTE (AC-10)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const orderId = await openOrderWith(undefined, [{ menuItemId: DOSA_ID, quantity: 1 }]);
    await actAs(USER_RECEPTION_A_ID);
    const settle = await settleDirect({ orderId, customerName: "Walk-in", tender: { mode: "CASH" } });
    if (!settle.ok) throw new Error("settle failed");

    await actAs(USER_ACCOUNTS_ID);
    const res = await voidOrder({ orderId, reason: "billing error" });
    expect(res.ok).toBe(true);
    const creditNote = await prisma.invoice.findFirst({ where: { cancelsInvoiceId: settle.data.invoiceId, type: "CREDIT_NOTE" } });
    expect(creditNote).not.toBeNull();
    expect((await prisma.posOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("VOID");
  });
});

describe("discount, KOT, checkout gate (T-12/T-13/T-14, FR-13/15/17, AC-11/12/13)", () => {
  it("an over-threshold discount writes an audited override (AC-11)", async () => {
    await actAs(USER_RECEPTION_A_ID); // Reception holds folio:discount (audited tier)
    const orderId = await openOrderWith(undefined, [{ menuItemId: DOSA_ID, quantity: 100 }]);
    const res = await applyDiscount({ orderId, amountPaise: 300_000, reason: "loyalty" }); // > ₹1,000 threshold
    expect(res.ok).toBe(true);
    const override = await prisma.auditLog.findFirst({ where: { action: "pos:discount-override", entityId: orderId } });
    expect(override).not.toBeNull();
  });

  it("sendToKitchen returns an aggregated prep list without settling (AC-12)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const orderId = await openOrderWith(undefined, [{ menuItemId: DOSA_ID, quantity: 2 }, { menuItemId: COFFEE_ID, quantity: 1 }]);
    const res = await sendToKitchen({ orderId });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.prep).toEqual(expect.arrayContaining([{ name: "Masala Dosa", quantity: 2 }, { name: "Coffee", quantity: 1 }]));
    expect((await prisma.posOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("OPEN");
  });

  it("unsettledOrders exposes open orders to the checkout gate, then clears on settle (AC-13)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const reservationId = await makeReservation("IN_HOUSE");
    const orderId = await openOrderWith(reservationId, [{ menuItemId: DOSA_ID, quantity: 1 }]);
    let claims = await actAs(USER_RECEPTION_A_ID);
    expect((await unsettledOrders(claims, reservationId)).map((o) => o.id)).toContain(orderId);
    await settleToFolio({ orderId });
    claims = await actAs(USER_RECEPTION_A_ID);
    expect(await unsettledOrders(claims, reservationId)).toHaveLength(0);
  });
});

describe("concurrency & RBAC (T-15/T-16, FR-14/18, AC-14/15)", () => {
  it("two concurrent settles → exactly one wins, the other ORDER_NOT_OPEN; one charge (AC-14)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const reservationId = await makeReservation("IN_HOUSE");
    const orderId = await openOrderWith(reservationId, [{ menuItemId: DOSA_ID, quantity: 1 }]);
    // Pre-create the folio so the concurrency assertion isolates the status claim
    // (not 06's ensureFolio create-race, a separate concern).
    await prisma.folio.create({ data: { propertyId: PROP_A_ID, kind: "RESERVATION", reservationId } });

    await actAs(USER_RECEPTION_A_ID);
    const [a, b] = await Promise.all([settleToFolio({ orderId }), settleToFolio({ orderId })]);
    const oks = [a, b].filter((r) => r.ok);
    const fails = [a, b].filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(fails).toHaveLength(1);
    if (!fails[0]!.ok) expect(fails[0]!.error.code).toBe("ORDER_NOT_OPEN");

    // Exactly one POS folio line posted — never double-charged.
    const folio = await prisma.folio.findFirstOrThrow({ where: { reservationId } });
    const posLines = await prisma.folioLine.count({ where: { folioId: folio.id, description: { contains: "POS " } } });
    expect(posLines).toBe(1);
  });

  it("settling without pos:order-settle is FORBIDDEN (AC-15)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const orderId = await openOrderWith(undefined, [{ menuItemId: DOSA_ID, quantity: 1 }]);
    await actAs(USER_HOUSEKEEPING_ID); // no pos:* permissions
    const res = await settleDirect({ orderId, customerName: "x", tender: { mode: "CASH" } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });
});
