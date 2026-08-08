/**
 * Realtime event stream (SSE) — `docs/api/api-surface.md`:
 *   `/api/realtime` · SSE live occupancy/sync · session, permission/property-filtered
 *
 * Consumed by 01 (property tiles, FR-7/AC-7), later 02 and 14.
 *
 * SCOPE NOTE. `tech-stack.md` lists realtime under *Platform services* and
 * `api-surface.md` places this route in the core API, so the channel itself is
 * platform infrastructure. Spec **17-mobile-experience** owns the layer above —
 * `LISTEN/NOTIFY` as the source, reconnect/backoff, offline queue, background
 * sync. 01 is a consumer and must not depend upward on a Tier-5 module.
 *
 * The database is polled ONCE PER PROCESS by `lib/events/broker`, not once per
 * connection: per-connection polling exhausted the connection pool and broke
 * sign-in under load.
 *
 * SECURITY (17 FR-5): the filter "must never forward an event outside the
 * subscriber's property scope/permissions, and must not include PII-bearing
 * payload fields". Only the event type and its aggregate id cross the wire —
 * the client re-fetches through its own authorized queries.
 */
import { getCurrentSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { scopeIncludes } from "@/lib/context";
import { subscribe, type BrokerEvent } from "@/lib/events/broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Keep-alive so proxies do not drop an idle stream. */
const HEARTBEAT_MS = 25_000;

/**
 * Event types a browser may learn about. An allow-list, not a deny-list: a new
 * event stays invisible to clients until someone deliberately adds it, which is
 * the safe default for a channel crossing a trust boundary.
 */
const BROADCASTABLE = new Set<string>([
  "RoomStatusChanged",
  "PropertyCreated",
  "PropertyUpdated",
  "PropertyDeactivated",
  // 17 T-6: live housekeeping + maintenance boards. All three carry propertyId
  // and are payload-stripped below, so property-scope filtering holds and no PII
  // crosses the wire (the client re-fetches through its own authorized query).
  "HousekeepingTaskDone",
  "MaintenanceJobCreated",
  "MaintenanceJobClosed",
]);

export async function GET(request: Request): Promise<Response> {
  const session = await getCurrentSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { claims } = session;
  const prisma = db.unscoped(); // every event is filtered per-row below

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (payload: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          closed = true;
        }
      };

      send("retry: 3000\n\n");
      send('event: ready\ndata: {"ok":true}\n\n');

      const onEvent = (event: BrokerEvent) => {
        if (event.orgId !== claims.orgId) return;
        if (!BROADCASTABLE.has(event.type)) return;
        // Property scope, enforced per event (17 FR-5).
        if (event.propertyId && !scopeIncludes(claims.propertyScope, event.propertyId)) return;

        // Type + aggregate id only. No payload — the client re-fetches through
        // its own authorized query, so nothing sensitive can leak here.
        send(
          `event: domain\ndata: ${JSON.stringify({
            type: event.type,
            propertyId: event.propertyId,
            aggregateId: event.aggregateId,
          })}\n\n`,
        );
      };

      const unsubscribe = subscribe(prisma, onEvent);
      const heartbeat = setInterval(() => send(": keep-alive\n\n"), HEARTBEAT_MS);

      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx and friends buffer by default, which would defeat the budget.
      "x-accel-buffering": "no",
    },
  });
}
