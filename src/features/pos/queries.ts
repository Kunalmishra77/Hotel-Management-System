/**
 * POS queries — 19 (FR-13/17). Property-scoped reads; callers pass claims. No PII
 * beyond the guest name front desk already sees. Money figures are the DERIVED
 * preview columns kept on the order (recomputed on every OPEN mutation).
 */
import { db } from "@/lib/db";
import { aggregatePrep, type PrepLine } from "./domain/kot";
import type { SessionClaims } from "@/lib/auth/claims";

export type PosOrderItemView = {
  id: string;
  menuItemId: string | null;
  name: string;
  quantity: number;
  unitPaise: number;
  amountPaise: number;
  hsnSac: string | null;
  gstBps: number;
};

export type PosOrderView = {
  id: string;
  code: string;
  outletId: string;
  status: string;
  reservationId: string | null;
  items: PosOrderItemView[];
  subtotalPaise: number;
  discountPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
};

const ORDER_SELECT = {
  id: true,
  code: true,
  outletId: true,
  status: true,
  reservationId: true,
  subtotalPaise: true,
  discountPaise: true,
  cgstPaise: true,
  sgstPaise: true,
  igstPaise: true,
  roundOffPaise: true,
  totalPaise: true,
  items: {
    select: { id: true, menuItemId: true, name: true, quantity: true, unitPaise: true, amountPaise: true, hsnSac: true, gstBps: true },
  },
} as const;

type OrderRow = {
  id: string; code: string; outletId: string; status: string; reservationId: string | null;
  subtotalPaise: number; discountPaise: number; cgstPaise: number; sgstPaise: number;
  igstPaise: number; roundOffPaise: number; totalPaise: number;
  items: PosOrderItemView[];
};

function toView(r: OrderRow): PosOrderView {
  return { ...r };
}

/** A single order with its items + derived preview. */
export async function getOrder(user: SessionClaims, orderId: string): Promise<PosOrderView | null> {
  const row = await db.scoped(user).posOrder.findFirst({ where: { id: orderId }, select: ORDER_SELECT });
  return row ? toView(row as OrderRow) : null;
}

/** OPEN orders at a property (optionally one outlet) — the POS working list. */
export async function listOpenOrders(
  user: SessionClaims,
  input: { propertyId: string; outletId?: string },
): Promise<PosOrderView[]> {
  const rows = await db.scoped(user).posOrder.findMany({
    where: { propertyId: input.propertyId, status: "OPEN", ...(input.outletId ? { outletId: input.outletId } : {}) },
    select: ORDER_SELECT,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((r) => toView(r as OrderRow));
}

/**
 * Unsettled (OPEN) POS orders for a reservation — the 03/06 CHECK-OUT GATE
 * (FR-17, AC-13). Check-out surfaces these so none silently vanishes; 06's
 * balance gate blocks/settles-first.
 */
export async function unsettledOrders(
  user: SessionClaims,
  reservationId: string,
): Promise<{ id: string; code: string; totalPaise: number }[]> {
  const rows = await db.scoped(user).posOrder.findMany({
    where: { reservationId, status: "OPEN" },
    select: { id: true, code: true, totalPaise: true },
    orderBy: { createdAt: "asc" },
  });
  return rows;
}

/** Aggregated kitchen prep list across all OPEN orders at a property (FR-13, AC-12). */
export async function kitchenPrep(user: SessionClaims, propertyId: string): Promise<PrepLine[]> {
  const orders = await db.scoped(user).posOrder.findMany({
    where: { propertyId, status: "OPEN" },
    select: { items: { select: { name: true, menuItemId: true, quantity: true } } },
  });
  return aggregatePrep(orders.flatMap((o) => o.items));
}

export type KitchenTicketView = {
  id: string;
  orderCode: string;
  status: "QUEUED" | "PREPARING" | "READY" | "SERVED";
  queuedAt: Date;
  items: { name: string; quantity: number }[];
};

/** Active kitchen tickets (not yet SERVED) at a property — the live prep board (FR-24/25). */
export async function kitchenTickets(user: SessionClaims, propertyId: string): Promise<KitchenTicketView[]> {
  const rows = await db.scoped(user).kitchenTicket.findMany({
    where: { propertyId, status: { not: "SERVED" } },
    orderBy: { queuedAt: "asc" },
    take: 100,
    select: {
      id: true,
      status: true,
      queuedAt: true,
      order: { select: { code: true, items: { select: { name: true, quantity: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    orderCode: r.order.code,
    status: r.status as KitchenTicketView["status"],
    queuedAt: r.queuedAt,
    items: r.order.items,
  }));
}

export type OutletView = { id: string; name: string; defaultGstBps: number };
export type MenuItemView = { id: string; name: string; ratePaise: number; hsnSac: string | null; gstBps: number };

/** Outlets at a property (the outlet switcher). */
export async function listOutlets(user: SessionClaims, propertyId: string): Promise<OutletView[]> {
  return db.scoped(user).posOutlet.findMany({
    where: { propertyId },
    select: { id: true, name: true, defaultGstBps: true },
    orderBy: { name: "asc" },
  });
}

/** Active menu for an outlet (the tap-to-add grid). */
export async function listMenu(user: SessionClaims, outletId: string): Promise<MenuItemView[]> {
  return db.scoped(user).menuItem.findMany({
    where: { outletId, isActive: true },
    select: { id: true, name: true, ratePaise: true, hsnSac: true, gstBps: true },
    orderBy: { name: "asc" },
  });
}
