/**
 * 19 addendum — guest QR ordering (T-26/27/28, FR-20/21/22/23/26). Real DB, 06
 * does the money, auth mocked at the boundary. Money rows are append-only, so
 * this suite never deletes Folio/FolioLine and leaves its reservation behind
 * (a fresh one per run); teardown removes only its own POS/room rows.
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

import { PROP_A_ID, GUEST_MEHTA_ID, USER_RECEPTION_A_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { db } from "@/lib/db";
import { submitGuestOrder, acceptGuestOrder, rejectGuestOrder } from "@/features/pos/guest-actions";

const prisma = createPrismaClient();
const RUN = Date.now().toString(36);
const CAT_ID = `cat_gq_${RUN}`;
const ROOM_ID = `room_gq_${RUN}`;
const OUTLET_ID = `outlet_gq_${RUN}`;
const DOSA_ID = `menu_gq_dosa_${RUN}`;
const RES_ID = `res_gq_${RUN}`;
const TOKEN = `guesttoken_${RUN}`;

async function actAs(userId: string): Promise<SessionClaims> {
  const claims = await assembleClaims(prisma, userId);
  if (!claims) throw new Error(`no claims for ${userId}`);
  authMock.current = claims;
  return claims;
}

async function submitTwoDosas() {
  const res = await submitGuestOrder({ token: TOKEN, lines: [{ menuItemId: DOSA_ID, quantity: 2 }], note: "extra chutney" });
  if (!res.ok) throw new Error(`submit failed: ${res.error.code}`);
  return res.data.orderId;
}

beforeAll(async () => {
  for (let i = 0; i < 3; i += 1) {
    try { await db.unscoped().$queryRawUnsafe("SELECT 1"); break; } catch (e) { if (i === 2) throw e; }
  }
  await prisma.roomCategory.create({ data: { id: CAT_ID, propertyId: PROP_A_ID, name: `GQ-${RUN}`, baseRatePaise: 300_000, maxAdults: 2, maxChildren: 1, gstBps: 1200 } });
  await prisma.room.create({ data: { id: ROOM_ID, propertyId: PROP_A_ID, categoryId: CAT_ID, number: `GQ-${RUN}`, orderToken: TOKEN } });
  await prisma.posOutlet.create({ data: { id: OUTLET_ID, propertyId: PROP_A_ID, name: `GQ-REST-${RUN}`, defaultGstBps: 500, isRoomDining: true } });
  await prisma.menuItem.create({ data: { id: DOSA_ID, propertyId: PROP_A_ID, outletId: OUTLET_ID, name: "Masala Dosa", ratePaise: 12_000, hsnSac: "996331", gstBps: 500 } });
  // Occupied: an IN_HOUSE reservation allocated to the room.
  await prisma.reservation.create({
    data: {
      id: RES_ID, propertyId: PROP_A_ID, code: `GQ-RES-${RUN}`, guestId: GUEST_MEHTA_ID, status: "IN_HOUSE",
      source: "WALK_IN", checkInDate: new Date("2036-01-10"), checkOutDate: new Date("2036-01-12"), nights: 2, ratePaise: 400_000,
    },
  });
  await prisma.roomAllocation.create({ data: { propertyId: PROP_A_ID, reservationId: RES_ID, roomId: ROOM_ID, startDate: new Date("2036-01-10"), endDate: new Date("2036-01-12") } });
});

beforeEach(() => { authMock.current = null; });

afterAll(async () => {
  await prisma.kitchenTicket.deleteMany({ where: { outletId: OUTLET_ID } });
  await prisma.posOrderItem.deleteMany({ where: { order: { outletId: OUTLET_ID } } });
  await prisma.posOrder.deleteMany({ where: { outletId: OUTLET_ID } });
  await prisma.menuItem.deleteMany({ where: { outletId: OUTLET_ID } });
  await prisma.posOutlet.deleteMany({ where: { id: OUTLET_ID } });
  await prisma.roomAllocation.deleteMany({ where: { reservationId: RES_ID } });
  await prisma.room.deleteMany({ where: { id: ROOM_ID } });
  await prisma.roomCategory.deleteMany({ where: { id: CAT_ID } });
  // Reservation + any Folio/FolioLine (append-only money) are left behind.
  await prisma.$disconnect();
});

describe("submitGuestOrder (FR-20/21/26)", () => {
  it("occupied room → REQUESTED, GUEST_QR, server-priced, event, nothing charged/kitchened", async () => {
    const orderId = await submitTwoDosas();
    const order = await prisma.posOrder.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    expect(order.status).toBe("REQUESTED");
    expect(order.source).toBe("GUEST_QR");
    expect(order.reservationId).toBe(RES_ID);
    expect(order.guestNote).toBe("extra chutney");
    // Server-priced from the menu (2 × 12000).
    expect(order.items[0]?.amountPaise).toBe(24_000);
    expect(order.subtotalPaise).toBe(24_000);
    // Nothing charged / no ticket yet.
    expect(await prisma.kitchenTicket.count({ where: { orderId } })).toBe(0);
    await prisma.domainEvent.findFirstOrThrow({ where: { type: "GuestOrderRequested", aggregateId: orderId } });
  });

  it("unknown token → ROOM_NOT_AVAILABLE", async () => {
    const res = await submitGuestOrder({ token: "nope-not-a-token", lines: [{ menuItemId: DOSA_ID, quantity: 1 }] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("ROOM_NOT_AVAILABLE");
  });
});

describe("accept / reject (FR-22/23)", () => {
  it("accept → SETTLED + KitchenTicket + FolioLine(FOOD) CGST+SGST on the room folio", async () => {
    const orderId = await submitTwoDosas();
    await actAs(USER_RECEPTION_A_ID); // has pos:order-create + pos:order-settle
    const res = await acceptGuestOrder({ orderId });
    expect(res.ok).toBe(true);

    const order = await prisma.posOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("SETTLED");
    expect(await prisma.kitchenTicket.count({ where: { orderId } })).toBe(1);

    const folio = await prisma.folio.findFirstOrThrow({ where: { reservationId: RES_ID } });
    const line = await prisma.folioLine.findFirstOrThrow({ where: { folioId: folio.id, type: "FOOD", description: `POS ${order.code}` } });
    expect(line.cgstPaise).toBe(600);
    expect(line.sgstPaise).toBe(600);
    expect(line.igstPaise).toBe(0);
  });

  it("reject → VOID and nothing charged", async () => {
    const orderId = await submitTwoDosas();
    await actAs(USER_RECEPTION_A_ID);
    // Reception lacks pos:order-void → rejected at authorization.
    const denied = await rejectGuestOrder({ orderId, reason: "test" });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe("FORBIDDEN");

    // A void-capable role succeeds; no folio line is created for this order.
    const claims = await assembleClaims(prisma, USER_RECEPTION_A_ID);
    if (!claims) throw new Error("no claims");
    authMock.current = { ...claims, resolvedPermissions: [...claims.resolvedPermissions, "pos:order-void"] };
    const ok = await rejectGuestOrder({ orderId, reason: "duplicate" });
    expect(ok.ok).toBe(true);
    const order = await prisma.posOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("VOID");
    const folio = await prisma.folio.findFirst({ where: { reservationId: RES_ID } });
    if (folio) {
      const line = await prisma.folioLine.findFirst({ where: { folioId: folio.id, description: `POS ${order.code}` } });
      expect(line).toBeNull();
    }
  });

  it("accept on an already-settled order → ORDER_NOT_REQUESTED", async () => {
    const orderId = await submitTwoDosas();
    await actAs(USER_RECEPTION_A_ID);
    expect((await acceptGuestOrder({ orderId })).ok).toBe(true);
    const again = await acceptGuestOrder({ orderId });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("ORDER_NOT_REQUESTED");
  });
});
