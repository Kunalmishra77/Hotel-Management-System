/**
 * Domain events + transactional outbox — 00 T-14 (FR-17/18/20, AC-16/17/19).
 *
 * FR-17: the event row is written in the SAME transaction as the state change,
 * so an event can never be lost because dispatch failed afterwards. Dispatch is
 * a separate concern (see dispatch.ts) reading rows this module wrote.
 *
 * Ordering (FR-18): `DomainEvent.seq` is a monotonic autoincrement assigned by
 * Postgres, giving a deterministic per-aggregate order even for several events
 * committed in one transaction. Cross-aggregate order is explicitly NOT implied.
 */
import type { Prisma } from "@prisma/client";
import { getContext } from "../context";
import type { DomainEventType } from "./catalog";

/**
 * The minimum a transaction client must offer to append an outbox row.
 * Structural for the same reason as `AuditCapableTx` — `db.scoped(user)`
 * returns an extended client whose transaction type is nominally different.
 */
export type EventCapableTx = {
  domainEvent: {
    create(args: {
      data: Prisma.DomainEventUncheckedCreateInput;
      select: { id: true };
    }): Promise<{ id: string }>;
  };
};

type Tx = EventCapableTx;

export type EmitEventInput = {
  type: DomainEventType;
  /** The entity this event is about — the ordering key. */
  aggregateId: string;
  payload?: Record<string, unknown>;
  propertyId?: string | null;
  /** Escape hatch for jobs outside a request context. */
  orgId?: string;
};

/**
 * Persist an event to the outbox inside the caller's transaction.
 *
 * Like writeAudit, `tx` is the first parameter so "same transaction" is the
 * only way to call it.
 */
export async function emitEvent(tx: Tx, input: EmitEventInput): Promise<string> {
  const ctx = getContext();

  const orgId = input.orgId ?? ctx?.orgId;
  if (!orgId) {
    throw new Error(
      `emitEvent("${input.type}") has no orgId: it must run inside runWithContext(), ` +
        "or pass orgId explicitly (background jobs use runWithSystemContext()).",
    );
  }

  const event = await tx.domainEvent.create({
    data: {
      orgId,
      propertyId: input.propertyId ?? ctx?.activePropertyId ?? null,
      type: input.type,
      aggregateId: input.aggregateId,
      // requestId is carried in the payload so a consumer can correlate an
      // effect back to the request that caused it.
      payload: {
        ...(input.payload ?? {}),
        ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
      } as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  return event.id;
}

export * from "./catalog";
