/**
 * Guaranteed late arrival (client, 12 Nov 2026). Alice was booked 10→30 Nov, didn't
 * come on the 10th, and called: "don't cancel — I'll come and pay from the 10th".
 * A held booking is never no-showed by the night audit, keeps its room, appears
 * in today's arrivals, and its check-in bills from the booked date.
 */
import { vi } from "vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

const h = vi.hoisted(() => ({ user: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("no acting user set");
    return h.user;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { PROP_A_ID, ROOM_101_ID, ROOM_102_ID, GUEST_MEHTA_ID, USER_RECEPTION_A_ID } from "../../prisma/seed/fixtures";
import { resetRoomsA } from "../../prisma/seed/01-property";
import { assembleClaims } from "@/lib/auth/claims";
import { createReservation } from "@/features/reservations/actions";
import { checkIn } from "@/features/reservations/lifecycle-actions";
import { setArrivalGuarantee } from "@/features/reservations/late-arrival-actions";
import { markNoShows } from "@/features/reservations/jobs";
import { arrivalsDepartures } from "@/features/reservations/queries";

const prisma = createPrismaClient();
const created: string[] = [];
const day = (s: string) => new Date(`${s}T00:00:00Z`);

beforeAll(async () => {
  const c = await assembleClaims(prisma, USER_RECEPTION_A_ID);
  if (!c) throw new Error("no claims");
  h.user = c;
  await resetRoomsA(prisma);
});

afterAll(async () => {
  if (created.length) {
    await prisma.roomAllocation.deleteMany({ where: { reservationId: { in: created } } });
    await prisma.reservation.updateMany({ where: { id: { in: created } }, data: { status: "CHECKED_OUT" } });
  }
  await resetRoomsA(prisma);
  await prisma.$disconnect();
});

const book = (roomId: string) => createReservation({
  propertyId: PROP_A_ID, guestId: GUEST_MEHTA_ID, source: "DIRECT", adults: 1, children: 0,
  roomIds: [roomId], checkInDate: "2028-04-10", checkOutDate: "2028-04-14", ratePaise: 200_000,
});

describe("guaranteed late arrival", () => {
  it("a held booking survives the no-show sweep, keeps its room, shows in arrivals, and bills from the booked date", async () => {
    const r = await book(ROOM_101_ID);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    created.push(r.data.id);
    expect((await setArrivalGuarantee({ reservationId: r.data.id, guaranteed: true })).ok).toBe(true);

    // Night audit closing 12 Apr: a normal booking from the 10th would be NO_SHOW now.
    await markNoShows(PROP_A_ID, day("2028-04-12"));
    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: r.data.id }, include: { allocations: true } });
    expect(after.status).toBe("CONFIRMED");
    expect(after.allocations.map((a) => a.roomId)).toEqual([ROOM_101_ID]); // room still held

    const ad = await arrivalsDepartures(h.user!, { propertyId: PROP_A_ID, date: day("2028-04-12") });
    expect(ad.arrivals.some((a) => a.id === r.data.id && a.arrivalGuaranteed)).toBe(true);

    // Arrives on the 12th — billed from the 10th.
    expect((await checkIn({ reservationId: r.data.id })).ok).toBe(true);
    const nights = await prisma.folioLine.findMany({ where: { folio: { reservationId: r.data.id }, type: "ROOM" }, select: { businessDate: true } });
    expect(nights.map((n) => n.businessDate.toISOString().slice(0, 10)).sort()).toEqual(["2028-04-10", "2028-04-11", "2028-04-12", "2028-04-13"]);
  });

  it("a booking already marked no-show comes back as a held booking (Alice)", async () => {
    const r = await book(ROOM_102_ID);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    created.push(r.data.id);
    await markNoShows(PROP_A_ID, day("2028-04-12"));
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r.data.id } })).status).toBe("NO_SHOW");

    const held = await setArrivalGuarantee({ reservationId: r.data.id, guaranteed: true });
    expect(held.ok, JSON.stringify(held)).toBe(true);
    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: r.data.id } });
    expect([row.status, row.arrivalGuaranteed]).toEqual(["CONFIRMED", true]);
    await markNoShows(PROP_A_ID, day("2028-04-13"));
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r.data.id } })).status).toBe("CONFIRMED"); // not re-no-showed

    // Guest not coming after all → hold removed; the normal no-show rule applies again.
    expect((await setArrivalGuarantee({ reservationId: r.data.id, guaranteed: false })).ok).toBe(true);
    await markNoShows(PROP_A_ID, day("2028-04-13"));
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r.data.id } })).status).toBe("NO_SHOW");
  });
});
