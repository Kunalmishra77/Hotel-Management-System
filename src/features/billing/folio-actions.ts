"use server";

/**
 * ensureDirectSaleFolio — 06 (FR-25). The idempotent house folio for walk-in POS
 * sales that have no reservation (`kind=DIRECT_SALE`, `reservationId` null). One
 * open house folio per property at a time; a second call returns the same one.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { toResult, type Result } from "@/lib/result";
import { billingDb, withBillingContext } from "./internal";
import { z } from "zod";

const schema = z.object({ propertyId: z.string().min(1) });

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
