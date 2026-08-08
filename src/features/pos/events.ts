/**
 * POS domain-event payload builders — 19 (FR-8/9/11). The event NAMES live in the
 * shared catalog (`src/lib/events/catalog.ts`): `PosOrderSettled`,
 * `PosOrderVoided`. These helpers keep the payload SHAPE in one place.
 *
 * `PosOrderSettled` is the contract 20-inventory consumes to deduct stock per
 * recipe (decoupled, idempotent on the order id). POS emits it and writes NO
 * inventory row itself. The `{ menuItemId, quantity }` array is exactly what 20's
 * `RecipeComponent` join needs; custom lines with no `menuItemId` are omitted from
 * the consumption payload (nothing to deduct).
 */

export type SettledItem = { menuItemId: string; quantity: number };

export type PosOrderSettledPayload = {
  orderId: string;
  code: string;
  propertyId: string;
  outletId: string;
  reservationId: string | null;
  /** How the money was settled — for analytics/audit consumers. */
  settlement: "FOLIO" | "DIRECT";
  totalPaise: number;
  /** Drives 20-inventory stock deduction (recipe components). */
  items: SettledItem[];
};

export type PosOrderVoidedPayload = {
  orderId: string;
  code: string;
  propertyId: string;
  reason: string;
  settlement: "FOLIO" | "DIRECT";
};

export function posOrderSettledPayload(input: PosOrderSettledPayload): Record<string, unknown> {
  return { ...input };
}

export function posOrderVoidedPayload(input: PosOrderVoidedPayload): Record<string, unknown> {
  return { ...input };
}

// 19 addendum: guest QR ordering + kitchen lifecycle. Payloads are PII-free — the
// realtime layer strips them to {type, propertyId, aggregateId} anyway, and the
// client re-fetches through its authorized query.

export type GuestOrderRequestedPayload = {
  orderId: string;
  code: string;
  propertyId: string;
  roomNumber: string;
};

export type KitchenTicketMovedPayload = {
  ticketId: string;
  orderId: string;
  propertyId: string;
  status: "QUEUED" | "PREPARING" | "READY" | "SERVED";
};

export function guestOrderRequestedPayload(input: GuestOrderRequestedPayload): Record<string, unknown> {
  return { ...input };
}

export function kitchenTicketMovedPayload(input: KitchenTicketMovedPayload): Record<string, unknown> {
  return { ...input };
}
