import "server-only";
/**
 * Add-on / upsell reads (Wave 3).
 *
 * - Catalog reads (`listActiveAddOns` / `getAddOn`) are the module's public
 *   surface: the guest request action and the guest booking-detail UI resolve
 *   the catalog through here rather than SELECTing the table directly.
 * - The staff inbox (`listPendingAddOnRequests`) is scoped to the caller's
 *   accessible properties (AddOnRequest is not a property-scoped model, so we
 *   filter explicitly) and gated on `reservation:view`.
 */
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export type CatalogAddOn = {
  id: string;
  propertyId: string;
  name: string;
  description: string | null;
  pricePaise: number;
  chargeType: string;
  hsnSac: string | null;
  taxRateBps: number | null;
  active: boolean;
};

/** Active catalog for a property, cheapest-configured order. */
export async function listActiveAddOns(propertyId: string): Promise<CatalogAddOn[]> {
  const rows = await db.unscoped().addOn.findMany({
    where: { propertyId, active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true, propertyId: true, name: true, description: true, pricePaise: true,
      chargeType: true, hsnSac: true, taxRateBps: true, active: true,
    },
  });
  return rows;
}

/** One catalog item by id (any active state — the caller checks `active`). */
export async function getAddOn(addOnId: string): Promise<CatalogAddOn | null> {
  return db.unscoped().addOn.findUnique({
    where: { id: addOnId },
    select: {
      id: true, propertyId: true, name: true, description: true, pricePaise: true,
      chargeType: true, hsnSac: true, taxRateBps: true, active: true,
    },
  });
}

export type PendingAddOnRequest = {
  id: string;
  propertyId: string;
  reservationId: string;
  reservationCode: string;
  reservationStatus: string;
  guestName: string;
  name: string;
  unitPaise: number;
  quantity: number;
  note: string | null;
  requestedAt: Date;
  /** IN_HOUSE means the charge can post now; otherwise it's awaiting check-in. */
  chargeable: boolean;
};

/** Pending (REQUESTED) add-on requests across the caller's properties, oldest first. */
export async function listPendingAddOnRequests(): Promise<PendingAddOnRequest[]> {
  const user = await requireUser();
  if (!hasPermission(user, "reservation:view") || user.accessiblePropertyIds.length === 0) return [];

  const rows = await db.unscoped().addOnRequest.findMany({
    where: {
      propertyId: { in: [...user.accessiblePropertyIds] },
      status: "REQUESTED",
    },
    orderBy: { requestedAt: "asc" },
    take: 100,
    select: {
      id: true, propertyId: true, reservationId: true, nameSnapshot: true,
      unitPaise: true, quantity: true, note: true, requestedAt: true,
      reservation: { select: { code: true, status: true, guest: { select: { fullName: true } } } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    propertyId: r.propertyId,
    reservationId: r.reservationId,
    reservationCode: r.reservation.code,
    reservationStatus: r.reservation.status,
    guestName: r.reservation.guest.fullName,
    name: r.nameSnapshot,
    unitPaise: r.unitPaise,
    quantity: r.quantity,
    note: r.note,
    requestedAt: r.requestedAt,
    chargeable: r.reservation.status === "IN_HOUSE",
  }));
}
