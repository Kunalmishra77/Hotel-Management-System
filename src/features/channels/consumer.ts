/**
 * Channels outbound consumer — 13 T-15 (FR-9/10, AC-9/10/11). Registered on 00's
 * dispatcher (worker). Reacts to availability/rate-affecting domain events,
 * recomputes the affected category/range, and pushes the CURRENT availability (or
 * an approved rate) to every active mapped channel — the ONE availability truth
 * stays in 03; 13 only mirrors it outward.
 *
 * Reliability (FR-13): pushes are idempotent (current-state), so on a provider
 * failure the consumer re-throws and lets the dispatcher retry with backoff and
 * dead-letter after the cap (a persistently-failing OUT row is also aged to
 * DEAD_LETTER by `deadLetterStalePushes`). This runs in the worker, never on the
 * request path — the front desk is never blocked.
 */
import type { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { registerConsumer, type EventConsumer, type EventEnvelope } from "@/lib/events/dispatch";
import { logger } from "@/lib/logger";
import { availabilityDelta, type ChannelTriggerType, type DeltaInput } from "./domain/availability-delta";
import { pushDeltaToChannels } from "./outbound";

const CONSUMED: readonly ChannelTriggerType[] = [
  "ReservationCreated",
  "ReservationModified",
  "ReservationCancelled",
  "RoomStatusChanged",
  "DynamicRateApproved",
];

/** Forward calendar window to refresh on a point-in-time status change. */
const WINDOW_DAYS = 365;

function startOfTodayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function plusDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}
function toDateOrNull(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" && value.length >= 10) {
    const d = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Resolve the delta input for an event (the I/O the pure delta function needs). */
async function resolveDelta(prisma: PrismaClient, envelope: EventEnvelope): Promise<DeltaInput | null> {
  const type = envelope.type as ChannelTriggerType;
  const payload = (envelope.payload ?? {}) as Record<string, unknown>;

  if (type === "RoomStatusChanged") {
    const room = await prisma.room.findUnique({
      where: { id: envelope.aggregateId },
      select: { propertyId: true, categoryId: true },
    });
    if (!room) return null;
    const from = startOfTodayUtc();
    return { type, propertyId: room.propertyId, categoryId: room.categoryId, from, to: plusDays(from, WINDOW_DAYS) };
  }

  if (type === "DynamicRateApproved") {
    const propertyId = (typeof payload.propertyId === "string" ? payload.propertyId : envelope.propertyId) ?? null;
    const categoryId = typeof payload.categoryId === "string" ? payload.categoryId : null;
    if (!propertyId || !categoryId) return null;
    const from = toDateOrNull(payload.from) ?? startOfTodayUtc();
    const to = toDateOrNull(payload.to) ?? plusDays(from, WINDOW_DAYS);
    const ratePaise = typeof payload.ratePaise === "number" ? payload.ratePaise : null;
    return { type, propertyId, categoryId, from, to, ratePaise };
  }

  // Reservation* — resolve category + range from the reservation's allocation.
  const reservation = await prisma.reservation.findUnique({
    where: { id: envelope.aggregateId },
    select: {
      propertyId: true,
      checkInDate: true,
      checkOutDate: true,
      allocations: { select: { room: { select: { categoryId: true } } }, take: 1 },
    },
  });
  if (!reservation) return null;
  const categoryId = reservation.allocations[0]?.room.categoryId ?? null;
  return {
    type,
    propertyId: reservation.propertyId,
    categoryId,
    from: reservation.checkInDate,
    to: reservation.checkOutDate,
  };
}

export async function handleChannelEvent(prisma: PrismaClient, envelope: EventEnvelope): Promise<void> {
  const input = await resolveDelta(prisma, envelope);
  if (!input) return;
  const delta = availabilityDelta(input);
  if (!delta) return;

  const { pushed, failed } = await pushDeltaToChannels(prisma, envelope.orgId, delta);
  if (pushed || failed) {
    logger.info("channel.push", { type: envelope.type, categoryId: delta.categoryId, pushed, failed });
  }
  // A failure re-throws so the dispatcher retries with backoff → dead-letter cap.
  if (failed > 0) {
    throw new Error(`channel push failed for ${failed} account(s) on ${envelope.type}`);
  }
}

export const channelsConsumer: EventConsumer = {
  name: "channels",
  types: CONSUMED,
  handle: (envelope) => handleChannelEvent(db.unscoped(), envelope),
};

let registered = false;
export function registerChannelsConsumer(): void {
  if (registered) return;
  registerConsumer(channelsConsumer);
  registered = true;
}
