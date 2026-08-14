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
import type { Permission } from "@/lib/permissions/permission-map";
import { db } from "@/lib/db";
import { registerConsumer, type EventConsumer, type EventEnvelope } from "@/lib/events/dispatch";
import {
  KIND_LABEL,
  isGuestRequestKind,
  departmentPermissionForKind,
} from "@/features/guest-account/domain/request-kind";
import { requiresSuperApproval } from "@/features/expenses/domain/escalation";
import { rolesThatCan } from "./domain/targets";

const TYPES = ["ReservationCreated", "GuestRequestCreated", "ExpenseRecorded"] as const;

/** Active users who hold `permission` at this property (org-scoped). Not a
 *  property-scoped model, so targeting is explicit: the role grants the permission
 *  AND (is org-wide Admin OR is assigned to this property). */
async function usersWithPermission(orgId: string, propertyId: string, permission: Permission): Promise<string[]> {
  const roles = rolesThatCan(permission);
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

/** Insert one notification per recipient, idempotent on (eventId, recipient). */
async function notify(
  recipients: string[],
  base: { orgId: string; propertyId: string | null; type: string; title: string; body: string; link: string; entityType: string; entityId: string; eventId: string },
): Promise<void> {
  if (recipients.length === 0) return;
  await db.unscoped().notification.createMany({
    data: recipients.map((uid) => ({
      orgId: base.orgId,
      propertyId: base.propertyId,
      recipientUserId: uid,
      type: base.type,
      title: base.title,
      body: base.body,
      link: base.link,
      entityType: base.entityType,
      entityId: base.entityId,
      eventId: base.eventId,
    })),
    skipDuplicates: true,
  });
}

/** A new ONLINE booking → the desk/management that can view reservations. */
async function handleReservationCreated(envelope: EventEnvelope): Promise<void> {
  const payload = (envelope.payload ?? {}) as Record<string, unknown>;
  if (payload.source !== "WEBSITE" || !envelope.propertyId) return; // only online bookings

  const r = await db.unscoped().reservation.findUnique({
    where: { id: envelope.aggregateId },
    select: { id: true, code: true, checkInDate: true, checkOutDate: true, guest: { select: { fullName: true } } },
  });
  if (!r) return;

  const recipients = await usersWithPermission(envelope.orgId, envelope.propertyId, "reservation:view");
  await notify(recipients, {
    orgId: envelope.orgId,
    propertyId: envelope.propertyId,
    type: "BOOKING_CREATED",
    title: "New online booking",
    body: `${r.guest.fullName} · ${r.code} · ${isoDay(r.checkInDate)}–${isoDay(r.checkOutDate)}`,
    link: `/bookings/${r.id}`,
    entityType: "Reservation",
    entityId: r.id,
    eventId: envelope.id,
  });
}

/** An in-room guest request → reception (the hub) + the owning department. */
async function handleGuestRequestCreated(envelope: EventEnvelope): Promise<void> {
  if (!envelope.propertyId) return;
  const req = await db.unscoped().guestRequest.findUnique({
    where: { id: envelope.aggregateId },
    select: { id: true, kind: true, detail: true, roomId: true },
  });
  if (!req || !isGuestRequestKind(req.kind)) return;

  const room = req.roomId
    ? await db.unscoped().room.findUnique({ where: { id: req.roomId }, select: { number: true } })
    : null;

  // Reception is always told; the department for housekeeping/maintenance too.
  const perms: Permission[] = ["reservation:view"];
  const dept = departmentPermissionForKind(req.kind);
  if (dept) perms.push(dept);

  const recipientSets = await Promise.all(
    perms.map((p) => usersWithPermission(envelope.orgId, envelope.propertyId!, p)),
  );
  const recipients = [...new Set(recipientSets.flat())];

  const where = room?.number ? `Room ${room.number}` : "A guest";
  await notify(recipients, {
    orgId: envelope.orgId,
    propertyId: envelope.propertyId,
    type: "GUEST_REQUEST",
    title: `${KIND_LABEL[req.kind]} request`,
    body: `${where} · ${req.detail.slice(0, 80)}`,
    link: "/requests",
    entityType: "GuestRequest",
    entityId: req.id,
    eventId: envelope.id,
  });
}

/** A recorded expense → the approver pool that can clear it (escalated by size). */
async function handleExpenseRecorded(envelope: EventEnvelope): Promise<void> {
  if (!envelope.propertyId) return;
  const payload = (envelope.payload ?? {}) as { head?: unknown; amountPaise?: unknown };
  const amountPaise = typeof payload.amountPaise === "number" ? payload.amountPaise : 0;
  const head = typeof payload.head === "string" ? payload.head : "Expense";

  // Major spend → Super Admin (expense:approve-large); minor → any approver.
  const permission = requiresSuperApproval(amountPaise) ? "expense:approve-large" : "expense:approve";
  const recipients = await usersWithPermission(envelope.orgId, envelope.propertyId, permission);

  const rupees = `₹${(amountPaise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  await notify(recipients, {
    orgId: envelope.orgId,
    propertyId: envelope.propertyId,
    type: "EXPENSE_APPROVAL",
    title: requiresSuperApproval(amountPaise) ? "Expense needs Super-Admin approval" : "Expense needs approval",
    body: `${head} · ${rupees}`,
    link: "/expenses",
    entityType: "Expense",
    entityId: envelope.aggregateId,
    eventId: envelope.id,
  });
}

export const notificationsConsumer: EventConsumer = {
  name: "notifications",
  types: TYPES,
  async handle(envelope: EventEnvelope) {
    if (envelope.type === "ReservationCreated") return handleReservationCreated(envelope);
    if (envelope.type === "GuestRequestCreated") return handleGuestRequestCreated(envelope);
    if (envelope.type === "ExpenseRecorded") return handleExpenseRecorded(envelope);
  },
};

let registered = false;
/** Register with the dispatcher (idempotent — safe to call twice). */
export function registerNotificationsConsumer(): void {
  if (registered) return;
  registerConsumer(notificationsConsumer);
  registered = true;
}
