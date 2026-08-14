/**
 * Notifications event consumer (Phase 3). Turns a domain event into per-recipient
 * `Notification` rows — the write path never calls this; it consumes the outbox
 * like comms/analytics do. v1 fires on a NEW ONLINE booking (ReservationCreated,
 * source=WEBSITE): the "customer booked → the hotel is told" signal.
 *
 * Idempotent two ways: the dispatcher dedupes on event id, AND the insert is
 * `createMany({ skipDuplicates })` against the unique (eventId, recipientUserId),
 * so a retry never double-notifies.
 */
import { db } from "@/lib/db";
import { registerConsumer, type EventConsumer, type EventEnvelope } from "@/lib/events/dispatch";
import { rolesThatCan } from "./domain/targets";

const TYPES = ["ReservationCreated"] as const;

/** Active users who can view reservations at this property (org-scoped). */
async function reservationViewers(orgId: string, propertyId: string): Promise<string[]> {
  const roles = rolesThatCan("reservation:view");
  // Not a property-scoped model — targeting is explicit: the role must grant the
  // permission AND (be org-wide Admin OR be assigned to this property).
  const rows = await db.unscoped().roleAssignment.findMany({
    where: {
      role: { in: roles },
      OR: [{ role: "ADMINISTRATOR" }, { propertyIds: { has: propertyId } }],
      user: { orgId, isActive: true, deletedAt: null },
    },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

export const notificationsConsumer: EventConsumer = {
  name: "notifications",
  types: TYPES,
  async handle(envelope: EventEnvelope) {
    if (envelope.type !== "ReservationCreated") return;
    const payload = (envelope.payload ?? {}) as Record<string, unknown>;
    if (payload.source !== "WEBSITE" || !envelope.propertyId) return; // only online bookings

    const prisma = db.unscoped();
    const r = await prisma.reservation.findUnique({
      where: { id: envelope.aggregateId },
      select: { id: true, code: true, checkInDate: true, checkOutDate: true, guest: { select: { fullName: true } } },
    });
    if (!r) return;

    const recipients = await reservationViewers(envelope.orgId, envelope.propertyId);
    if (recipients.length === 0) return;

    const body = `${r.guest.fullName} · ${r.code} · ${isoDay(r.checkInDate)}–${isoDay(r.checkOutDate)}`;
    await prisma.notification.createMany({
      data: recipients.map((uid) => ({
        orgId: envelope.orgId,
        propertyId: envelope.propertyId,
        recipientUserId: uid,
        type: "BOOKING_CREATED",
        title: "New online booking",
        body,
        link: `/bookings/${r.id}`,
        entityType: "Reservation",
        entityId: r.id,
        eventId: envelope.id,
      })),
      skipDuplicates: true,
    });
  },
};

let registered = false;
/** Register with the dispatcher (idempotent — safe to call twice). */
export function registerNotificationsConsumer(): void {
  if (registered) return;
  registerConsumer(notificationsConsumer);
  registered = true;
}
