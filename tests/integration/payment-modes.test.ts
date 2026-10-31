/**
 * Payment modes everywhere money is recorded (client, 31 Oct 2026): the booking's
 * advance carries its mode to the folio; "already paid" (OTA prepaid) leaves
 * nothing due; an extension re-booked on an OTA records its prepayment; a wrong
 * payment entry is corrected (cancelled + re-entered) without deleting anything.
 * Dates in 2027 so the past-date rule never trips.
 */
import { vi } from "vitest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
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

import { PROP_A_ID, ROOM_101_ID, ROOM_102_ID, GUEST_MEHTA_ID, USER_RECEPTION_A_ID } from "../../prisma/seed/fixtures";
import { resetRoomsA } from "../../prisma/seed/01-property";
import { assembleClaims } from "@/lib/auth/claims";
import { createReservation } from "@/features/reservations/actions";
import { checkIn } from "@/features/reservations/lifecycle-actions";
import { extendStay } from "@/features/reservations/move-actions";
import { correctPaymentEntry } from "@/features/billing/payment-actions";
import { getFolio } from "@/features/billing/queries";

const prisma = createPrismaClient();
const created: string[] = [];

async function actAs(userId: string): Promise<SessionClaims> {
  const c = await assembleClaims(prisma, userId);
  if (!c) throw new Error("no claims");
  authMock.current = c;
  return c;
}
const body = (o: Record<string, unknown>) => ({
  propertyId: PROP_A_ID, guestId: GUEST_MEHTA_ID, source: "AGODA" as const, adults: 1, children: 0,
  checkInDate: "2027-09-10", checkOutDate: "2027-09-12", ratePaise: 200_000, ...o,
});
async function folioId(reservationId: string) {
  return (await prisma.folio.findFirstOrThrow({ where: { reservationId }, select: { id: true } })).id;
}

beforeEach(async () => { authMock.current = null; await resetRoomsA(prisma); });
afterEach(async () => {
  if (created.length) {
    await prisma.roomAllocation.deleteMany({ where: { reservationId: { in: created } } });
    // Folios with lines/payments are append-only — neutralize their bookings.
    await prisma.reservation.updateMany({ where: { id: { in: created } }, data: { status: "CHECKED_OUT" } });
    created.length = 0;
  }
  await resetRoomsA(prisma);
});
afterAll(async () => { await prisma.$disconnect(); });

describe("booking advance mode", () => {
  it("posts the advance to the folio with the mode chosen at booking (UPI, not a guessed Cash)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createReservation(body({ roomIds: [ROOM_101_ID], source: "DIRECT", advancePaise: 100_000, advanceMode: "UPI" }));
    if (!res.ok) throw new Error(res.error.message);
    created.push(res.data.id);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: res.data.id } })).advanceMode).toBe("UPI");
    expect((await checkIn({ reservationId: res.data.id })).ok).toBe(true);
    const pay = await prisma.payment.findFirstOrThrow({ where: { folioId: await folioId(res.data.id), reference: `ADVANCE:${res.data.id}` } });
    expect(pay.mode).toBe("UPI");
    expect(Number(pay.amountPaise)).toBe(100_000);
  });

  it("'Already paid' for the whole bill (OTA prepaid) leaves nothing due", async () => {
    await actAs(USER_RECEPTION_A_ID);
    // 2 nights × ₹2,000 + 5% = ₹4,200, prepaid on Agoda.
    const res = await createReservation(body({ roomIds: [ROOM_102_ID], settlementIntent: "ALREADY_PAID", advancePaise: 420_000, advanceMode: "ONLINE" }));
    if (!res.ok) throw new Error(res.error.message);
    created.push(res.data.id);
    await checkIn({ reservationId: res.data.id });
    const claims = await actAs(USER_RECEPTION_A_ID);
    const folio = await getFolio(claims, await folioId(res.data.id));
    expect(folio?.balancePaise).toBe(0);
    expect(folio?.payments.find((p) => !p.isRefund)?.mode).toBe("ONLINE");
  });
});

describe("extension paid on an OTA", () => {
  it("records the extension's prepayment with its mode and channel — the extra nights are not due", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createReservation(body({ roomIds: [ROOM_101_ID], settlementIntent: "ALREADY_PAID", advancePaise: 420_000, advanceMode: "ONLINE" }));
    if (!res.ok) throw new Error(res.error.message);
    created.push(res.data.id);
    await checkIn({ reservationId: res.data.id });
    // Guest re-books 2 more nights on Agoda at ₹1,800 + GST = ₹3,780, prepaid.
    const ext = await extendStay({
      reservationId: res.data.id, newCheckOutDate: "2027-09-14", ratePaise: 180_000, gstMode: "exclusive",
      paid: { amountPaise: 378_000, mode: "ONLINE", via: "Agoda" },
    });
    expect(ext.ok).toBe(true);
    const claims = await actAs(USER_RECEPTION_A_ID);
    const folio = await getFolio(claims, await folioId(res.data.id));
    expect(folio?.balancePaise).toBe(0);
    expect(folio?.payments.some((p) => p.reference?.includes("Agoda"))).toBe(true);
  });

  it("without a payment the extra nights are due at the hotel", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createReservation(body({ roomIds: [ROOM_102_ID], settlementIntent: "ALREADY_PAID", advancePaise: 420_000, advanceMode: "ONLINE" }));
    if (!res.ok) throw new Error(res.error.message);
    created.push(res.data.id);
    await checkIn({ reservationId: res.data.id });
    // Direct at ₹2,500 + GST for one more night = ₹2,625 due.
    expect((await extendStay({ reservationId: res.data.id, newCheckOutDate: "2027-09-13", ratePaise: 250_000, gstMode: "exclusive" })).ok).toBe(true);
    const claims = await actAs(USER_RECEPTION_A_ID);
    expect((await getFolio(claims, await folioId(res.data.id)))?.balancePaise).toBe(262_500);
  });
});

describe("correcting a wrong payment entry", () => {
  it("cancels the wrong entry and re-enters it with the right mode — balance unchanged, nothing deleted", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createReservation(body({ roomIds: [ROOM_101_ID], source: "DIRECT", advancePaise: 100_000, advanceMode: "CASH" }));
    if (!res.ok) throw new Error(res.error.message);
    created.push(res.data.id);
    await checkIn({ reservationId: res.data.id });
    const fid = await folioId(res.data.id);
    const claims = await actAs(USER_RECEPTION_A_ID);
    const before = await getFolio(claims, fid);
    const wrong = before!.payments.find((p) => p.mode === "CASH" && !p.isRefund)!;

    const fix = await correctPaymentEntry({ paymentId: wrong.id, reason: "guest paid by UPI, not cash", newMode: "UPI" });
    expect(fix.ok).toBe(true);
    const after = await getFolio(claims, fid);
    expect(after?.balancePaise).toBe(before?.balancePaise);
    expect(await prisma.payment.count({ where: { id: wrong.id } })).toBe(1); // still there
    expect(after?.payments.some((p) => p.mode === "UPI" && !p.isRefund && p.amountPaise === 100_000)).toBe(true);

    // A second correction of the same entry is refused.
    const again = await correctPaymentEntry({ paymentId: wrong.id, reason: "again", newMode: "UPI" });
    expect(again.ok).toBe(false);
    expect(await prisma.auditLog.findFirst({ where: { action: "payment:correct", entityId: wrong.id } })).not.toBeNull();
  });
});
