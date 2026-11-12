/**
 * PMS Agent (client, 12 Nov 2026) — answers platform questions from live data,
 * no external AI. Room occupant, booking code, guest by name, in-house list,
 * how-to, and the permission gate.
 */
import { vi } from "vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => { throw new Error("not used"); } }));

import { GUEST_RAVI_ID, PROP_A_ID, ROOM_103_ID, USER_ADMIN_ID, USER_HOUSEKEEPING_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { answerAgent } from "@/features/ai/agent";

const prisma = createPrismaClient();
let admin: SessionClaims;
const CODE = `BK-AGENT${Date.now().toString(36).slice(-4).toUpperCase()}`;
let resId = "";

beforeAll(async () => {
  const c = await assembleClaims(prisma, USER_ADMIN_ID);
  if (!c) throw new Error("no claims");
  admin = c;
  // A stay of our own (the per-file reset leaves no bookings): Ravi, in-house in 103.
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const r = await prisma.reservation.create({
    data: {
      code: CODE, propertyId: PROP_A_ID, guestId: GUEST_RAVI_ID, source: "DIRECT", status: "IN_HOUSE",
      checkInDate: today, checkOutDate: new Date(today.getTime() + 2 * 86_400_000), nights: 2, adults: 1, ratePaise: 200_000,
      allocations: { create: { propertyId: PROP_A_ID, roomId: ROOM_103_ID, startDate: today, endDate: new Date(today.getTime() + 2 * 86_400_000) } },
    },
    select: { id: true },
  });
  resId = r.id;
});
afterAll(async () => {
  if (resId) {
    await prisma.roomAllocation.deleteMany({ where: { reservationId: resId } });
    await prisma.reservation.deleteMany({ where: { id: resId } });
  }
  await prisma.$disconnect();
});

describe("PMS Agent answers from live data", () => {
  it("how-to and help need no data", async () => {
    const g = await answerAgent(admin, { question: "extend kaise kare" });
    expect(g.steps?.length).toBeGreaterThan(2);
    const h = await answerAgent(admin, { question: "help" });
    expect(h.matched).toBe(false);
    expect(h.steps?.length).toBeGreaterThan(3);
  });

  it("finds a booking by code and by the guest's name, with its stay", async () => {
    const r = await prisma.reservation.findUniqueOrThrow({ where: { id: resId }, select: { code: true, guest: { select: { fullName: true } } } });
    const byCode = await answerAgent(admin, { question: `${r.code} ka status` });
    expect(byCode.items?.[0]?.title).toContain(r.code);
    const first = r.guest.fullName.split(" ")[0]!;
    const byName = await answerAgent(admin, { question: r.guest.fullName });
    expect(byName.items?.some((i) => i.title.toLowerCase().includes(first.toLowerCase()))).toBe(true);
  });

  it("says who is in a room, and lists who is staying", async () => {
    const room = await prisma.room.findUniqueOrThrow({ where: { id: ROOM_103_ID }, select: { number: true } });
    const a = await answerAgent(admin, { question: `room ${room.number} me kaun hai` });
    expect(a.answer).toMatch(new RegExp(room.number, "i"));
    expect(a.items?.some((i) => i.title.includes(CODE))).toBe(true); // Ravi is in it
    const inHouse = await answerAgent(admin, { question: "abhi kaun kaun ruka hai" });
    expect(inHouse.answer).toMatch(/staying right now/);
    expect(inHouse.items?.some((i) => i.title.includes(CODE))).toBe(true);
  });

  it("is gated: a role without ai:use is refused", async () => {
    const hk = await assembleClaims(prisma, USER_HOUSEKEEPING_ID);
    if (!hk) throw new Error("no claims");
    await expect(answerAgent(hk, { question: "help" })).rejects.toThrow();
  });
});
