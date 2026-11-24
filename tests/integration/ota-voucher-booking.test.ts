/**
 * Pasted OTA voucher → booking (client, 24 Nov 2026): the OTA's booking id is kept
 * on the reservation, and the same voucher pasted twice never takes a second room.
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

import { PROP_A_ID, ROOM_103_ID, ROOM_104_ID, GUEST_MEHTA_ID, USER_ADMIN_ID } from "../../prisma/seed/fixtures";
import { resetRoomsA } from "../../prisma/seed/01-property";
import { assembleClaims } from "@/lib/auth/claims";
import { createReservation } from "@/features/reservations/actions";

const prisma = createPrismaClient();
const ref = `NH7303${Date.now()}`;
const made: string[] = [];

beforeAll(async () => {
  h.user = await assembleClaims(prisma, USER_ADMIN_ID);
  await resetRoomsA(prisma);
});
afterAll(async () => {
  await prisma.roomAllocation.deleteMany({ where: { reservationId: { in: made } } });
  await prisma.reservation.updateMany({ where: { id: { in: made } }, data: { status: "CANCELLED" } });
  await resetRoomsA(prisma);
  await prisma.$disconnect();
});

describe("OTA booking id from a pasted voucher", () => {
  it("is saved on the booking, and the same voucher can't be booked twice", async () => {
    const base = {
      propertyId: PROP_A_ID, guestId: GUEST_MEHTA_ID, source: "MAKEMYTRIP", adults: 2, children: 0,
      checkInDate: "2027-11-03", checkOutDate: "2027-11-06", ratePaise: 277_698,
      settlementIntent: "ALREADY_PAID", advancePaise: 874_749, advanceMode: "ONLINE", channelRef: ref,
    };
    const first = await createReservation({ ...base, roomIds: [ROOM_103_ID] });
    expect(first.ok, JSON.stringify(first)).toBe(true);
    if (!first.ok) return;
    made.push(first.data.id);
    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: first.data.id }, select: { channelRef: true, source: true } });
    expect(row).toEqual({ channelRef: ref, source: "MAKEMYTRIP" });

    const again = await createReservation({ ...base, roomIds: [ROOM_104_ID] });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.message).toContain(ref);
  });
});
