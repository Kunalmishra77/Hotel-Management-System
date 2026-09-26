"use server";

/**
 * ensureDirectSaleFolio — 06 (FR-25). The idempotent house folio for walk-in POS
 * sales that have no reservation (`kind=DIRECT_SALE`, `reservationId` null). One
 * open house folio per property at a time; a second call returns the same one.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { billingDb, withBillingContext } from "./internal";
import { z } from "zod";

const schema = z.object({ propertyId: z.string().min(1) });
const reservationFolioSchema = z.object({ reservationId: z.string().min(1) });

/**
 * Create the folio for a reservation that doesn't have one yet — e.g. a stay saved
 * via Data Entry as "history only" (no rate) that now needs a bill (add food/charges
 * the client already collected for). Idempotent: returns the existing folio if there
 * is one. The reservation's own property is used; caller needs folio:charge there.
 */
export async function createReservationFolio(input: unknown): Promise<Result<{ folioId: string }>> {
  return toResult(async () => {
    const { reservationId } = reservationFolioSchema.parse(input);
    const user = await requireUser();
    const client = billingDb(user);
    const reservation = await client.reservation.findFirst({
      where: { id: reservationId },
      select: { id: true, propertyId: true },
    });
    if (!reservation) throw new NotFoundError("Booking not found.");
    authorize(user, "folio:charge", reservation.propertyId);

    const existing = await client.folio.findUnique({ where: { reservationId }, select: { id: true } });
    if (existing) return { folioId: existing.id };

    return withBillingContext(user, () =>
      client.$transaction(async (tx) => {
        const folio = await tx.folio.create({
          data: { propertyId: reservation.propertyId, reservationId, kind: "RESERVATION" },
          select: { id: true },
        });
        await writeAudit(tx, { action: "folio:create", entityType: "Folio", entityId: folio.id, propertyId: reservation.propertyId, after: { reservationId } });
        return { folioId: folio.id };
      }),
    );
  });
}

export async function ensureDirectSaleFolio(input: unknown): Promise<Result<{ folioId: string }>> {
  return toResult(async () => {
    const { propertyId } = schema.parse(input);
    const user = await requireUser();
    authorize(user, "folio:charge", propertyId);
    const client = billingDb(user);

    const existing = await client.folio.findFirst({
      where: { propertyId, kind: "DIRECT_SALE", isClosed: false },
      select: { id: true },
    });
    if (existing) return { folioId: existing.id };

    return withBillingContext(user, () =>
      client.$transaction(async (tx) => {
        const folio = await tx.folio.create({
          data: { propertyId, kind: "DIRECT_SALE", reservationId: null },
          select: { id: true },
        });
        await writeAudit(tx, { action: "folio:open-direct-sale", entityType: "Folio", entityId: folio.id, propertyId, after: { kind: "DIRECT_SALE" } });
        return { folioId: folio.id };
      }),
    );
  });
}
