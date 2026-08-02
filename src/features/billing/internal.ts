/**
 * Shared internals for the billing actions. NOT a "use server" module.
 *
 * Scoped-db accessor, request-context wrapper, error classifiers (serialization
 * retry / unique / lock timeout), and the folio-context loader that resolves the
 * property state + guest bill-to state a charge needs to decide place of supply.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";
import type { SessionClaims } from "@/lib/auth/claims";

export function billingDb(user: SessionClaims) {
  return db.scoped(user);
}

export function withBillingContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
  return runWithContext(
    {
      orgId: user.orgId,
      userId: user.userId,
      propertyScope: user.propertyScope,
      activePropertyId: user.activePropertyId,
      requestId: newRequestId(),
      ip: null,
      device: null,
    },
    fn,
  );
}

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export function isSerializationError(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const code = (e.meta as { code?: string } | undefined)?.code;
  return code === "40001" || code === "40P01";
}

/** The context a charge needs: property state (place of supply) + guest bill-to. */
export type FolioContext = {
  folioId: string;
  propertyId: string;
  propertyState: string;
  billToState: string | null;
  isClosed: boolean;
  reservationId: string | null;
  /** The property's open business date; charges before it are back-dated (FR-15). */
  currentBusinessDate: Date | null;
};

/**
 * Load a folio with the state fields GST needs. Uses the scoped client, so a
 * folio outside the caller's property scope is invisible (→ null).
 */
export async function loadFolioContext(
  client: ReturnType<typeof billingDb>,
  folioId: string,
): Promise<FolioContext | null> {
  const folio = await client.folio.findFirst({
    where: { id: folioId },
    select: {
      id: true,
      propertyId: true,
      isClosed: true,
      reservationId: true,
      reservation: { select: { guest: { select: { state: true } } } },
    },
  });
  if (!folio) return null;
  // Folio has no `property` relation in the schema — resolve state + business date directly.
  const property = await client.property.findFirst({
    where: { id: folio.propertyId },
    select: { state: true, currentBusinessDate: true },
  });
  return {
    folioId: folio.id,
    propertyId: folio.propertyId,
    propertyState: property?.state ?? "",
    billToState: folio.reservation?.guest.state ?? null,
    isClosed: folio.isClosed,
    reservationId: folio.reservationId,
    currentBusinessDate: property?.currentBusinessDate ?? null,
  };
}

export const FOLIO_LINE_SELECT = {
  id: true,
  type: true,
  description: true,
  quantity: true,
  unitPaise: true,
  amountPaise: true,
  taxRateBps: true,
  cgstPaise: true,
  sgstPaise: true,
  igstPaise: true,
  hsnSac: true,
  placeOfSupplyState: true,
  businessDate: true,
  reversalOfId: true,
} as const;
