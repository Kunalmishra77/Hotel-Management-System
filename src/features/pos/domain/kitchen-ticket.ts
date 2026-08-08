/**
 * KitchenTicket state machine — 19 addendum FR-24. Forward-only, one step at a
 * time: QUEUED → PREPARING → READY → SERVED. Pure; no I/O.
 */
export type TicketStatus = "QUEUED" | "PREPARING" | "READY" | "SERVED";

const ORDER: readonly TicketStatus[] = ["QUEUED", "PREPARING", "READY", "SERVED"] as const;

/** The single successor of `from`, or null once SERVED (terminal). */
export function nextTicketStatus(from: TicketStatus): TicketStatus | null {
  const i = ORDER.indexOf(from);
  return i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1]! : null;
}

/** True only for a forward, one-step advance — no skips, no backward, no self. */
export function canAdvanceTicket(from: TicketStatus, to: TicketStatus): boolean {
  return nextTicketStatus(from) === to;
}
