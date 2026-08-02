/**
 * 25's domain-event surface. Names live in the central catalogue
 * (`@/lib/events/catalog`); this re-exports the four 25 emits so callers and
 * tests reference one constant rather than a string literal.
 *
 * NOTE: `CorporateReceivableChanged` is 06's event (emitted after it calls
 * `reserveCredit`/`releaseCredit`), NOT 25's — 06 owns the receivable write.
 * `CreditThresholdReached` is reserved for a consumer of that event (a worker
 * job) to raise when an account nears its limit; 25 does not emit it inline
 * because `reserveCredit`'s behaviour is frozen for 06.
 */
import type { DomainEventType } from "@/lib/events/catalog";

export const CORPORATE_EVENTS = {
  corporateCreated: "CorporateCreated",
  agentCreated: "AgentCreated",
  negotiatedRateSet: "NegotiatedRateSet",
  creditThresholdReached: "CreditThresholdReached",
} as const satisfies Record<string, DomainEventType>;
