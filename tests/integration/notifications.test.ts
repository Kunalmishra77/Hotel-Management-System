/**
 * Phase 3 — notifications consumer.
 *
 * A new ONLINE booking (ReservationCreated, source=WEBSITE) must create one
 * Notification for each staffer who can view reservations at that property — and
 * for nobody else — and be idempotent under event re-delivery.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import {
  ORG_ID,
  PROP_A_ID,
  USER_RECEPTION_A_ID,
  USER_MANAGER_ID,
  USER_HOUSEKEEPING_ID,
} from "../../prisma/seed/fixtures";
import { notificationsConsumer } from "@/features/notifications/consumer";
import type { EventEnvelope } from "@/lib/events/dispatch";

const prisma = createPrismaClient();
const NONCE = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const EVENT_ID = `evt_notif_${NONCE}`;

let guestId = "";
let reservationId = "";

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { eventId: EVENT_ID } });
  if (reservationId) await prisma.reservation.deleteMany({ where: { id: reservationId } });
  if (guestId) await prisma.guest.deleteMany({ where: { id: guestId } });
  await prisma.$disconnect();
});

function envelope(): EventEnvelope {
  return {
    id: EVENT_ID,
    seq: 1n,
    type: "ReservationCreated",
    orgId: ORG_ID,
    propertyId: PROP_A_ID,
    aggregateId: reservationId,
    payload: { code: "WEB-TEST", status: "CONFIRMED", source: "WEBSITE", hold: false, nights: 2 },
    occurredAt: new Date(),
  };
}

describe("notifications consumer", () => {
  it("notifies reservation viewers at the property, once, idempotently", async () => {
    const g = await prisma.guest.create({
      data: { orgId: ORG_ID, fullName: "Online Booker", mobile: "enc", mobileHash: `nh_${NONCE}` },
      select: { id: true },
    });
    guestId = g.id;
    const r = await prisma.reservation.create({
      data: {
        propertyId: PROP_A_ID, code: `WEB-${NONCE}`, guestId, status: "CONFIRMED", source: "WEBSITE",
        checkInDate: new Date("2027-03-01"), checkOutDate: new Date("2027-03-03"),
        nights: 2, adults: 2, ratePaise: 500000, taxPaise: 60000, advancePaise: 0,
      },
      select: { id: true },
    });
    reservationId = r.id;

    await notificationsConsumer.handle(envelope());

    const rows = await prisma.notification.findMany({
      where: { eventId: EVENT_ID },
      select: { recipientUserId: true, type: true, link: true, title: true },
    });
    const recipients = rows.map((x) => x.recipientUserId);

    // Desk + management get it…
    expect(recipients).toContain(USER_RECEPTION_A_ID);
    expect(recipients).toContain(USER_MANAGER_ID);
    // …operational-only staff do not.
    expect(recipients).not.toContain(USER_HOUSEKEEPING_ID);
    // Shape.
    expect(rows.every((x) => x.type === "BOOKING_CREATED")).toBe(true);
    expect(rows.every((x) => x.link === `/bookings/${reservationId}`)).toBe(true);

    // Re-delivery of the SAME event creates no duplicates (idempotent).
    const before = rows.length;
    await notificationsConsumer.handle(envelope());
    const after = await prisma.notification.count({ where: { eventId: EVENT_ID } });
    expect(after).toBe(before);
  });

  it("ignores non-WEBSITE bookings", async () => {
    const env = { ...envelope(), id: `${EVENT_ID}_direct`, payload: { source: "DIRECT" } };
    await notificationsConsumer.handle(env);
    const n = await prisma.notification.count({ where: { eventId: `${EVENT_ID}_direct` } });
    expect(n).toBe(0);
  });
});
