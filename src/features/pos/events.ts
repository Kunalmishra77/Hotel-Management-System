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
