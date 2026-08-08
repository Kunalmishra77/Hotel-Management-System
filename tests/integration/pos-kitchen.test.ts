/**
 * 19 addendum — kitchen ticket lifecycle (T-23, FR-24/25). Real DB, auth mocked at
 * the boundary (mirrors pos.test.ts). Self-contained outlet + menu; teardown
 * removes only this module's rows (incl. KitchenTicket).
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

import { PROP_A_ID, USER_RECEPTION_A_ID, USER_HOUSEKEEPING_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { db } from "@/lib/db";
import { createOrder, addItem, sendToKitchen } from "@/features/pos/actions";
import { startTicket, readyTicket, serveTicket } from "@/features/pos/kitchen-actions";

const prisma = createPrismaClient();
const RUN = Date.now().toString(36);
const OUTLET_ID = `outlet_kt_${RUN}`;
const DOSA_ID = `menu_kt_dosa_${RUN}`;

async function actAs(userId: string): Promise<SessionClaims> {
  const claims = await assembleClaims(prisma, userId);
  if (!claims) throw new Error(`no claims for ${userId}`);
  authMock.current = claims;
  return claims;
}

async function openOrder(): Promise<string> {
  const created = await createOrder({ outletId: OUTLET_ID });
  if (!created.ok) throw new Error(`createOrder: ${created.error.code}`);
  const added = await addItem({ orderId: created.data.id, menuItemId: DOSA_ID, quantity: 2 });
  if (!added.ok) throw new Error(`addItem: ${added.error.code}`);
  return created.data.id;
}

async function ticketFor(orderId: string) {
  return prisma.kitchenTicket.findUniqueOrThrow({ where: { orderId } });
}

beforeAll(async () => {
  // Warm the managed-DB connection first — a cold Prisma engine / cold pooler
  // connection can throw on the run's very first op (see playwright.config note).
  // This primes the APP client the actions use, so no test pays the cold start.
  for (let i = 0; i < 3; i += 1) {
    try {
      await db.unscoped().$queryRawUnsafe("SELECT 1");
      break;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  await prisma.posOutlet.create({ data: { id: OUTLET_ID, propertyId: PROP_A_ID, name: `KT-${RUN}`, defaultGstBps: 500 } });
  await prisma.menuItem.create({ data: { id: DOSA_ID, propertyId: PROP_A_ID, outletId: OUTLET_ID, name: "Masala Dosa", ratePaise: 12_000, hsnSac: "996331", gstBps: 500 } });
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

describe("sendToKitchen creates a ticket (T-23, FR-24)", () => {
  it("creates exactly one QUEUED ticket and is idempotent on re-send", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const orderId = await openOrder();

    const first = await sendToKitchen({ orderId });
    expect(first.ok).toBe(true);
    const t1 = await ticketFor(orderId);
    expect(t1.status).toBe("QUEUED");

    // Re-KOT the same order — still one ticket, still QUEUED (no duplicate).
    const second = await sendToKitchen({ orderId });
    expect(second.ok).toBe(true);
    const count = await prisma.kitchenTicket.count({ where: { orderId } });
    expect(count).toBe(1);

    await prisma.domainEvent.findFirstOrThrow({ where: { type: "KitchenTicketMoved", aggregateId: t1.id } });
  });
});

describe("advance the ticket (T-23, FR-24)", () => {
  it("QUEUED→PREPARING→READY→SERVED stamps each timestamp + emits events", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const orderId = await openOrder();
    await sendToKitchen({ orderId });
    const t = await ticketFor(orderId);

    expect((await startTicket({ ticketId: t.id })).ok).toBe(true);
    expect((await ticketFor(orderId)).status).toBe("PREPARING");
    expect((await ticketFor(orderId)).startedAt).not.toBeNull();

    expect((await readyTicket({ ticketId: t.id })).ok).toBe(true);
    expect((await ticketFor(orderId)).status).toBe("READY");

    expect((await serveTicket({ ticketId: t.id })).ok).toBe(true);
    const served = await ticketFor(orderId);
    expect(served.status).toBe("SERVED");
    expect(served.servedAt).not.toBeNull();
  });

  it("rejects an illegal skip (QUEUED→SERVED) with ILLEGAL_TICKET_TRANSITION", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const orderId = await openOrder();
    await sendToKitchen({ orderId });
    const t = await ticketFor(orderId);

    const res = await serveTicket({ ticketId: t.id });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("ILLEGAL_TICKET_TRANSITION");
    expect((await ticketFor(orderId)).status).toBe("QUEUED");
  });
});

describe("RBAC (FR-14)", () => {
  it("denies advancing a ticket without pos:order-create", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const orderId = await openOrder();
    await sendToKitchen({ orderId });
    const t = await ticketFor(orderId);

    await actAs(USER_HOUSEKEEPING_ID); // no pos permissions
    const res = await startTicket({ ticketId: t.id });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });
});
