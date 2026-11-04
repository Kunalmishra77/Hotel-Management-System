/**
 * Reservation events → guest messages (4 Nov 2026). The events carry only the
 * booking code; the consumer must resolve the guest + stay itself and render the
 * dates — and must NOT message a back-dated past stay (Data Entry backfill).
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

import { ORG_ID, PROP_A_ID, ROOM_103_ID, GUEST_RAVI_ID, USER_ADMIN_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { createReservation } from "@/features/reservations/actions";
import { communicationsConsumer } from "@/features/communications/events/consumer";
import type { EventEnvelope } from "@/lib/events/dispatch";

const prisma = createPrismaClient();
const KEY = "STAY_EVT_TEST";
const AUTO = "stay_evt_test_auto";
let resId = "";

const envelope = (type: string, aggregateId: string, occurredAt: Date): EventEnvelope => ({
  id: `stay_evt_${Math.random().toString(36).slice(2)}`, seq: 1n, type, orgId: ORG_ID, propertyId: PROP_A_ID, aggregateId, payload: { code: "x" }, occurredAt,
});

beforeAll(async () => {
  const c = await assembleClaims(prisma, USER_ADMIN_ID);
  if (!c) throw new Error("no claims");
  h.user = c;
  await prisma.messageTemplate.upsert({
    where: { orgId_key_channel_language: { orgId: ORG_ID, key: KEY, channel: "EMAIL", language: "en" } },
    create: { orgId: ORG_ID, key: KEY, channel: "EMAIL", language: "en", body: "Dear {{guestName}}, {{bookingCode}}: {{checkInDate}} to {{checkOutDate}}, {{nights}} nights, room {{roomNumber}}.", isActive: true },
    update: { isActive: true },
  });
  await prisma.messageAutomation.upsert({
    where: { id: AUTO },
    create: { id: AUTO, orgId: ORG_ID, category: "BEFORE_ARRIVAL", triggerEvent: "ReservationCreated", templateKey: KEY, channel: "EMAIL", isActive: true },
    update: { isActive: true },
  });
  const r = await createReservation({ propertyId: PROP_A_ID, source: "DIRECT", adults: 1, children: 0, ratePaise: 200_000, guestId: GUEST_RAVI_ID, roomIds: [ROOM_103_ID], checkInDate: "2028-03-10", checkOutDate: "2028-03-12" });
  if (!r.ok) throw new Error(r.error.message);
  resId = r.data.id;
});

afterAll(async () => {
  await prisma.messageLog.deleteMany({ where: { templateKey: KEY } });
  await prisma.messageAutomation.deleteMany({ where: { id: AUTO } });
  await prisma.messageTemplate.deleteMany({ where: { orgId: ORG_ID, key: KEY } });
  await prisma.roomAllocation.deleteMany({ where: { reservationId: resId } });
  await prisma.reservation.updateMany({ where: { id: resId }, data: { status: "CANCELLED" } });
  await prisma.$disconnect();
});

describe("reservation events → guest email", () => {
  it("resolves the guest from the booking and renders the stay dates and room", async () => {
    await communicationsConsumer.handle(envelope("ReservationCreated", resId, new Date("2028-03-01T06:00:00Z")));
    const log = await prisma.messageLog.findFirst({ where: { templateKey: KEY, guestId: GUEST_RAVI_ID }, orderBy: { createdAt: "desc" } });
    expect(log, "a message was generated").not.toBeNull();
    const event = await prisma.domainEvent.findUniqueOrThrow({ where: { id: log!.triggeredByEvent! } });
    const body = String((event.payload as Record<string, unknown>).body);
    expect(body).toMatch(/Fri, 10 Mar 2028 to Sun, 12 Mar 2028, 2 nights, room 103/);
    expect(body).toContain("BK-");
  });

  it("sends nothing for a back-dated past stay", async () => {
    const before = await prisma.messageLog.count({ where: { templateKey: KEY } });
    await communicationsConsumer.handle(envelope("ReservationCreated", resId, new Date("2028-04-01T06:00:00Z")));
    expect(await prisma.messageLog.count({ where: { templateKey: KEY } })).toBe(before);
  });
});
