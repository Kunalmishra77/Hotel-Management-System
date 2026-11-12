/**
 * PMS Agent commands (client, 12 Nov 2026): an instruction becomes a proposal;
 * nothing changes until it is confirmed; the confirmed command runs through the
 * screen's own server action. Extend, payment, room clean, and the "anything
 * wrong?" scan with its fix.
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

import { GUEST_MEHTA_ID, PROP_A_ID, ROOM_101_ID, ROOM_102_ID, ROOM_104_ID, USER_ADMIN_ID } from "../../prisma/seed/fixtures";
import { resetRoomsA } from "../../prisma/seed/01-property";
import { assembleClaims } from "@/lib/auth/claims";
import { createReservation } from "@/features/reservations/actions";
import { checkIn } from "@/features/reservations/lifecycle-actions";
import { answerAgent } from "@/features/ai/agent";
import { runAgentCommand } from "@/features/ai/actions";

const prisma = createPrismaClient();
const created: string[] = [];
const ymd = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  const c = await assembleClaims(prisma, USER_ADMIN_ID);
  if (!c) throw new Error("no claims");
  h.user = { ...c, activePropertyId: PROP_A_ID };
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

async function book(roomId: string, from: number, to: number) {
  const r = await createReservation({ propertyId: PROP_A_ID, guestId: GUEST_MEHTA_ID, source: "DIRECT", adults: 1, children: 0, roomIds: [roomId], checkInDate: ymd(from), checkOutDate: ymd(to), ratePaise: 200_000 });
  if (!r.ok) throw new Error(JSON.stringify(r));
  created.push(r.data.id);
  return prisma.reservation.findUniqueOrThrow({ where: { id: r.data.id }, select: { id: true, code: true } });
}

describe("PMS Agent does things — only after Confirm", () => {
  it("extends a stay and records a payment", async () => {
    const b = await book(ROOM_101_ID, 0, 2);
    expect((await checkIn({ reservationId: b.id })).ok).toBe(true);

    const a = await answerAgent(h.user!, { question: `${b.code} ko ${ymd(4)} tak extend karo` });
    expect(a.proposal?.command.action).toBe("extend");
    // Nothing changed yet.
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: b.id } })).checkOutDate.toISOString().slice(0, 10)).toBe(ymd(2));
    const ran = await runAgentCommand(a.proposal!.command);
    expect(ran.ok, JSON.stringify(ran)).toBe(true);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: b.id } })).checkOutDate.toISOString().slice(0, 10)).toBe(ymd(4));

    const pay = await answerAgent(h.user!, { question: `${b.code} me 2100 upi jama karo` });
    expect(pay.proposal?.command).toMatchObject({ action: "payment", amountPaise: 210_000, mode: "UPI" });
    expect((await runAgentCommand(pay.proposal!.command)).ok).toBe(true);
    expect(await prisma.payment.count({ where: { folio: { reservationId: b.id }, mode: "UPI", amountPaise: 210_000n } })).toBe(1);
  });

  it("marks a room clean", async () => {
    await prisma.room.update({ where: { id: ROOM_104_ID }, data: { status: "HOUSEKEEPING" } });
    const room = await prisma.room.findUniqueOrThrow({ where: { id: ROOM_104_ID }, select: { number: true } });
    const a = await answerAgent(h.user!, { question: `room ${room.number} clean ho gaya` });
    expect(a.proposal?.command.action).toBe("roomStatus");
    expect((await runAgentCommand(a.proposal!.command)).ok).toBe(true);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: ROOM_104_ID } })).status).toBe("VACANT");
  });

  it("the scan finds a missed arrival and its fix holds the booking", async () => {
    const b = await book(ROOM_102_ID, 0, 3);
    // Make it due two days ago, never checked in (New Booking refuses past dates).
    await prisma.reservation.update({ where: { id: b.id }, data: { checkInDate: new Date(`${ymd(-2)}T00:00:00Z`) } });
    const scan = await answerAgent(h.user!, { question: "koi galti hai kya check karo" });
    const item = scan.items?.find((i) => i.title.includes(b.code) && i.proposal);
    expect(item?.proposal?.command.action).toBe("holdLate");
    expect((await runAgentCommand(item!.proposal!.command)).ok).toBe(true);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: b.id } })).arrivalGuaranteed).toBe(true);
  });

  it("a tampered command is refused", async () => {
    const bad = await runAgentCommand({ action: "deleteEverything" });
    expect(bad.ok).toBe(false);
  });
});
