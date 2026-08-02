/**
 * 26 domain-event helpers. Thin wrappers over `emitEvent` so the two events this
 * module owns (`ImportCommitted`, `ImportRolledBack` — catalog.ts) are emitted
 * with a consistent payload shape. Consumed by no one today (26 feeds the other
 * modules); analytics sees the imported records like any other data.
 */
import { emitEvent, type EventCapableTx } from "@/lib/events";

export function emitImportCommitted(
  tx: EventCapableTx,
  input: { batchId: string; kind: string; okCount: number; propertyId?: string | null },
): Promise<string> {
  return emitEvent(tx, {
    type: "ImportCommitted",
    aggregateId: input.batchId,
    propertyId: input.propertyId ?? null,
    payload: { kind: input.kind, okCount: input.okCount },
  });
}

export function emitImportRolledBack(
  tx: EventCapableTx,
  input: { batchId: string; kind: string; voided: number; propertyId?: string | null },
): Promise<string> {
  return emitEvent(tx, {
    type: "ImportRolledBack",
    aggregateId: input.batchId,
    propertyId: input.propertyId ?? null,
    payload: { kind: input.kind, voided: input.voided },
  });
}
