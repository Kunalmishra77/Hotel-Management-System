/**
 * Accounting-sync event consumer — 22 T-5 (FR-2, AC-5/6/11). Registered on 00's
 * dispatcher (worker). For each SETTLED-FINANCE event it enqueues a sync (one
 * PENDING AccountingSyncLog per configured provider); the `syncWorker` sweep then
 * performs the idempotent push off the request path.
 *
 * CRITICAL (AC-11): 22 consumes ONLY settled finance events — issued invoices,
 * received payments, refunds, recorded expenses, finalized payroll. It does NOT
 * consume raw `FolioCharged`: 06 posts many folio lines per stay, and syncing
 * each would double-count against the invoice the accounting system journals
 * from. `FolioCharged` is deliberately absent from `CONSUMED` — asserted in the
 * integration test.
 */
import { db } from "@/lib/db";
import { runWithSystemContext } from "@/lib/context";
import { registerConsumer, type EventConsumer, type EventEnvelope } from "@/lib/events/dispatch";
import { enqueueSync } from "./sync";
import type { AccountingEntityType } from "./domain/to-accounting-doc";

/** The settled-finance events 22 mirrors to accounting (design.md § Events). */
const CONSUMED = [
  "InvoiceIssued", // 06 — issued invoice / credit note
  "PaymentReceived", // 06 — received payment (single or split batch)
  "PaymentRefunded", // 06 — refund
  "ExpenseRecorded", // 07 — recorded expense
  "PayrollFinalized", // 21 — finalized salary journal
  // NB: FolioCharged is intentionally NOT here (no double entries — AC-11).
] as const;

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The (entityType, entityId) a sync is keyed by. Payments key on the settlement
 * batch (received) or payment id (refund) so each is a distinct, reloadable
 * document; the DomainEvent id is the last-resort fallback (see internal loader).
 */
export function entityRefForEvent(
  envelope: EventEnvelope,
): { entityType: AccountingEntityType; entityId: string } | null {
  const p = (envelope.payload ?? {}) as Record<string, unknown>;
  switch (envelope.type) {
    case "InvoiceIssued":
      return { entityType: "Invoice", entityId: envelope.aggregateId };
    case "ExpenseRecorded":
      return { entityType: "Expense", entityId: envelope.aggregateId };
    case "PayrollFinalized":
      return { entityType: "Payroll", entityId: envelope.aggregateId };
    case "PaymentReceived":
      return { entityType: "Payment", entityId: str(p.settlementBatchId) ?? envelope.id };
    case "PaymentRefunded":
      return { entityType: "Payment", entityId: str(p.paymentId) ?? envelope.id };
    default:
      return null; // includes FolioCharged and anything else — never enqueued
  }
}

export const accountingConsumer: EventConsumer = {
  name: "accounting",
  types: CONSUMED,
  async handle(envelope) {
    const ref = entityRefForEvent(envelope);
    if (!ref) return; // defensive — CONSUMED already excludes FolioCharged
    await runWithSystemContext(envelope.orgId, () =>
      enqueueSync(db.unscoped(), envelope.orgId, ref.entityType, ref.entityId),
    );
  },
};

let registered = false;
/** Register the accounting consumer with the dispatcher (idempotent). */
export function registerAccountingConsumer(): void {
  if (registered) return;
  registerConsumer(accountingConsumer);
  registered = true;
}
