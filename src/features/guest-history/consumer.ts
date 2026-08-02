/**
 * Guest-history event consumer — 05 T-5/T-5b (FR-2/2b, AC-3/8/9/10).
 *
 * Listens to the full folio-mutating set plus checkout/feedback/merge, resolves
 * the affected guest(s) from the event, and recomputes their snapshot from
 * source. Idempotent two ways: the dispatcher dedupes on event id, AND recompute
 * derives from source so even a re-delivery converges (no double count). On
 * `GuestMerged`, BOTH survivor and loser are recomputed (FR-2b).
 */
import { db } from "@/lib/db";
import { registerConsumer, type EventConsumer, type EventEnvelope } from "@/lib/events/dispatch";
import { recomputeGuestStats } from "./recompute";

const TYPES = [
  "FolioCharged", "DiscountApplied", "PaymentReceived", "PaymentRefunded",
  "InvoiceIssued", "GuestCheckedOut", "FeedbackReceived", "GuestMerged",
] as const;

/** Resolve the guest id(s) a given event affects. */
async function resolveGuestIds(envelope: EventEnvelope): Promise<string[]> {
  const prisma = db.unscoped();
  const payload = (envelope.payload ?? {}) as Record<string, unknown>;

  switch (envelope.type) {
    case "GuestMerged": {
      // aggregateId = survivor; payload.loserId = loser — recompute both (FR-2b).
      const loserId = typeof payload.loserId === "string" ? payload.loserId : null;
      return [envelope.aggregateId, ...(loserId ? [loserId] : [])];
    }
    case "GuestCheckedOut": {
      const r = await prisma.reservation.findUnique({ where: { id: envelope.aggregateId }, select: { guestId: true } });
      return r ? [r.guestId] : [];
    }
    case "FeedbackReceived": {
      if (typeof payload.guestId === "string") return [payload.guestId];
      const f = await prisma.feedback.findUnique({ where: { id: envelope.aggregateId }, select: { guestId: true } });
      return f ? [f.guestId] : [];
    }
    case "InvoiceIssued": {
      const inv = await prisma.invoice.findUnique({ where: { id: envelope.aggregateId }, select: { folio: { select: { reservation: { select: { guestId: true } } } } } });
      const g = inv?.folio.reservation?.guestId;
      return g ? [g] : [];
    }
    default: {
      // Folio-mutating events: aggregateId = folioId → guest via the reservation.
      // (Direct-sale house folios have no reservation → no guest history.)
      const folio = await prisma.folio.findUnique({ where: { id: envelope.aggregateId }, select: { reservation: { select: { guestId: true } } } });
      const g = folio?.reservation?.guestId;
      return g ? [g] : [];
    }
  }
}

export const guestHistoryConsumer: EventConsumer = {
  name: "guest-history",
  types: TYPES,
  async handle(envelope) {
    const guestIds = await resolveGuestIds(envelope);
    for (const guestId of guestIds) {
      await recomputeGuestStats(envelope.orgId, guestId);
    }
  },
};

let registered = false;
/** Register the consumer with the dispatcher (idempotent — safe to call twice). */
export function registerGuestHistoryConsumer(): void {
  if (registered) return;
  registerConsumer(guestHistoryConsumer);
  registered = true;
}
