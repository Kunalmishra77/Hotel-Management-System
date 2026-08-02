/**
 * Process-wide realtime event broker.
 *
 * ONE poller per server process, fanned out to every SSE subscriber.
 *
 * The first version of `/api/realtime` polled `DomainEvent` per connection.
 * That looked fine with a single browser tab and fell over immediately under
 * load: with N connected staff it issued N queries per second, each contending
 * for the connection pool, and starved ordinary requests —
 *   "Timed out fetching a new connection from the connection pool"
 * — so sign-in itself began to fail. Polling cost must be O(1) in the number of
 * viewers, not O(N).
 *
 * The poller starts on the first subscriber and stops on the last, so an idle
 * server issues no queries at all.
 *
 * Spec 17-mobile-experience replaces the poll with Postgres `LISTEN/NOTIFY`;
 * the subscribe/publish surface below does not change when it does.
 */
import type { PrismaClient } from "@prisma/client";
import { logger } from "../logger";

export type BrokerEvent = {
  seq: bigint;
  type: string;
  orgId: string;
  propertyId: string | null;
  aggregateId: string;
};

type Subscriber = (event: BrokerEvent) => void;

/** Comfortably inside the <2s event→screen budget (NFRs). */
export const BROKER_POLL_MS = 1_000;

/** Cap a single fetch so a backlog cannot produce an unbounded batch. */
const BATCH_SIZE = 100;

const subscribers = new Set<Subscriber>();
let timer: ReturnType<typeof setInterval> | null = null;
let cursor: bigint | null = null;
let polling = false;

async function poll(prisma: PrismaClient): Promise<void> {
  // Never overlap: a slow query must not stack another on top of it, which is
  // how a transient blip turns into pool exhaustion.
  if (polling) return;
  polling = true;

  try {
    if (cursor === null) {
      // First tick: start from "now". A new subscriber wants what happens
      // next, not the entire history of the outbox.
      const latest = await prisma.domainEvent.aggregate({ _max: { seq: true } });
      cursor = latest._max.seq ?? 0n;
      return;
    }

    const events = await prisma.domainEvent.findMany({
      where: { seq: { gt: cursor } },
      orderBy: { seq: "asc" },
      take: BATCH_SIZE,
      select: { seq: true, type: true, orgId: true, propertyId: true, aggregateId: true },
    });
    if (events.length === 0) return;

    cursor = events[events.length - 1]!.seq;

    for (const event of events) {
      for (const subscriber of subscribers) {
        try {
          subscriber(event);
        } catch {
          // One broken subscriber must not stop delivery to the others.
        }
      }
    }
  } catch (e) {
    // A transient failure must not kill the broker; the next tick retries.
    logger.warn("realtime.poll_failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    polling = false;
  }
}

/**
 * Register a listener. Returns an unsubscribe function; the poller stops once
 * the last listener has gone.
 */
export function subscribe(prisma: PrismaClient, listener: Subscriber): () => void {
  subscribers.add(listener);

  if (!timer) {
    timer = setInterval(() => void poll(prisma), BROKER_POLL_MS);
    // Do not hold the process open on this interval alone.
    timer.unref?.();
    logger.info("realtime.broker_started", { pollMs: BROKER_POLL_MS });
  }

  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
      cursor = null; // next subscriber starts from "now" again
      logger.info("realtime.broker_stopped");
    }
  };
}

/** Test/diagnostic helpers. */
export function subscriberCount(): number {
  return subscribers.size;
}

export function isPolling(): boolean {
  return timer !== null;
}
