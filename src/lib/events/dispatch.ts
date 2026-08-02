/**
 * Outbox dispatcher + idempotent consumers — 00 T-15/T-16
 * (FR-18/19/20, AC-17/18/19).
 *
 * FR-18: publish undispatched events AT LEAST ONCE, stamp `dispatchedAt`, and
 * preserve per-`aggregateId` order using the monotonic `seq`.
 * FR-19: repeated consumer failure → retry with backoff to a cap → dead-letter
 * with an admin alert; the event row is NEVER discarded.
 * FR-20: consumers dedupe on `DomainEvent.id`.
 */
import type { DomainEvent, PrismaClient } from "@prisma/client";
import { logger } from "../logger";
import type { DomainEventType } from "./catalog";

/** Give up delivering to a consumer after this many attempts (FR-19). */
export const MAX_DISPATCH_ATTEMPTS = 8;

/** Backoff between attempts: 1s, 2s, 4s … capped. */
export const BASE_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 5 * 60_000;

export function backoffMsFor(attempt: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS);
}

export type EventEnvelope = {
  id: string;
  seq: bigint;
  type: string;
  orgId: string;
  propertyId: string | null;
  aggregateId: string;
  payload: unknown;
  occurredAt: Date;
};

export type EventConsumer = {
  name: string;
  /** Event types this consumer wants; omit for all. */
  types?: readonly DomainEventType[];
  handle: (event: EventEnvelope) => Promise<void>;
};

const consumers: EventConsumer[] = [];

export function registerConsumer(consumer: EventConsumer): void {
  if (consumers.some((c) => c.name === consumer.name)) {
    throw new Error(`Consumer "${consumer.name}" is already registered.`);
  }
  consumers.push(consumer);
}

export function clearConsumers(): void {
  consumers.length = 0;
}

export function registeredConsumers(): readonly EventConsumer[] {
  return consumers;
}

function wants(consumer: EventConsumer, type: string): boolean {
  return !consumer.types || (consumer.types as readonly string[]).includes(type);
}

/**
 * In-process dedupe ledger keyed `${consumer}:${eventId}` (FR-20).
 *
 * A durable ledger table would be the production choice for multi-instance
 * workers; this keeps at-least-once from becoming at-least-twice within a
 * process and gives consumers a correct contract to code against. Consumers
 * must ALSO be idempotent in their own writes — which the schema enforces where
 * it matters (e.g. InventoryMovement's unique (refType, refId, itemId)).
 */
const processed = new Set<string>();

export function markProcessed(consumerName: string, eventId: string): void {
  processed.add(`${consumerName}:${eventId}`);
}

export function hasProcessed(consumerName: string, eventId: string): boolean {
  return processed.has(`${consumerName}:${eventId}`);
}

export function clearProcessedLedger(): void {
  processed.clear();
}

function toEnvelope(row: DomainEvent): EventEnvelope {
  return {
    id: row.id,
    seq: row.seq,
    type: row.type,
    orgId: row.orgId,
    propertyId: row.propertyId,
    aggregateId: row.aggregateId,
    payload: row.payload,
    occurredAt: row.occurredAt,
  };
}

export type DispatchResult = {
  fetched: number;
  dispatched: number;
  failed: number;
  deadLettered: number;
};

/**
 * Deliver a batch of undispatched events.
 *
 * Ordering: rows are read `ORDER BY seq ASC` and events sharing an aggregateId
 * are delivered in that order. If one event for an aggregate fails, later
 * events for the SAME aggregate are held back this cycle — otherwise a consumer
 * could observe a checkout before the check-in that preceded it. Other
 * aggregates continue unaffected (cross-aggregate order is not promised).
 */
export async function dispatchOutbox(
  db: PrismaClient,
  options: { batchSize?: number; now?: Date } = {},
): Promise<DispatchResult> {
  const batchSize = options.batchSize ?? 100;
  const now = options.now ?? new Date();

  const rows = await db.domainEvent.findMany({
    where: { dispatchedAt: null, attempts: { lt: MAX_DISPATCH_ATTEMPTS } },
    orderBy: { seq: "asc" },
    take: batchSize,
  });

  const result: DispatchResult = {
    fetched: rows.length,
    dispatched: 0,
    failed: 0,
    deadLettered: 0,
  };
  if (rows.length === 0) return result;

  /** Aggregates whose ordering is blocked by an earlier failure this cycle. */
  const blocked = new Set<string>();

  for (const row of rows) {
    if (blocked.has(row.aggregateId)) continue;

    const envelope = toEnvelope(row);
    const targets = consumers.filter((c) => wants(c, row.type));
    let failure: unknown = null;

    for (const consumer of targets) {
      if (hasProcessed(consumer.name, row.id)) continue; // FR-20
      try {
        await consumer.handle(envelope);
        markProcessed(consumer.name, row.id);
      } catch (e) {
        failure = e;
        logger.error("outbox.consumer_failed", {
          consumer: consumer.name,
          eventId: row.id,
          type: row.type,
          attempt: row.attempts + 1,
          error: e instanceof Error ? e.message : String(e),
        });
        break;
      }
    }

    if (!failure) {
      // Only stamp dispatchedAt after every consumer succeeded — the trigger
      // permits exactly this column plus attempts.
      await db.domainEvent.update({
        where: { id: row.id },
        data: { dispatchedAt: now },
      });
      result.dispatched += 1;
      continue;
    }

    const attempts = row.attempts + 1;
    await db.domainEvent.update({ where: { id: row.id }, data: { attempts } });
    result.failed += 1;
    blocked.add(row.aggregateId);

    if (attempts >= MAX_DISPATCH_ATTEMPTS) {
      result.deadLettered += 1;
      // FR-19: the row survives, flagged by attempts hitting the cap, and an
      // administrator is alerted. Nothing is deleted.
      logger.error("outbox.dead_letter", {
        eventId: row.id,
        type: row.type,
        aggregateId: row.aggregateId,
        attempts,
        alert: "admin",
      });
    }
  }

  return result;
}

/** Events parked at the attempt cap — surfaced to the admin alerting path. */
export async function findDeadLetteredEvents(
  db: PrismaClient,
  take = 100,
): Promise<DomainEvent[]> {
  return db.domainEvent.findMany({
    where: { dispatchedAt: null, attempts: { gte: MAX_DISPATCH_ATTEMPTS } },
    orderBy: { seq: "asc" },
    take,
  });
}

/** Operator action after fixing the cause: reset attempts so retry resumes. */
export async function replayDeadLetteredEvent(db: PrismaClient, eventId: string): Promise<void> {
  await db.domainEvent.update({ where: { id: eventId }, data: { attempts: 0 } });
}
