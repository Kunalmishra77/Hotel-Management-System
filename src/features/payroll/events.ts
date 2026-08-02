/**
 * Payroll domain events (21) — names live in `lib/events/catalog.ts`; this file
 * documents the payload shapes consumers (07/08/22/14) can rely on. Emitted on
 * the canonical write path inside the mutation transaction (business-rules §20).
 */
import type { DomainEventType } from "@/lib/events";

export const PAYROLL_EVENTS = {
  runGenerated: "PayrollRunGenerated",
  lineAdjusted: "PayrollLineAdjusted",
  finalized: "PayrollFinalized",
} satisfies Record<string, DomainEventType>;

/** `PayrollRunGenerated` — a DRAFT run + its lines now exist. */
export type PayrollRunGeneratedPayload = {
  month: string;
  sequence: number;
  runType: string;
  lineCount: number;
  netTotalPaise: number;
};

/** `PayrollLineAdjusted` — a DRAFT line's components/net changed. */
export type PayrollLineAdjustedPayload = {
  runId: string;
  netPaise: number;
  overridden: boolean;
};

/**
 * `PayrollFinalized` — the single, authoritative staff-salary cost for the
 * `(property, month)`. 07/08/22 consume this for cost; the same figure is never
 * hand-keyed as a 07 STAFF expense (reporting.md — counted once).
 */
export type PayrollFinalizedPayload = {
  month: string;
  sequence: number;
  netTotalPaise: number;
};
