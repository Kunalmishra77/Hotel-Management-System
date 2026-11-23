"use server";

/**
 * Put a booking on company credit, or take it off (client, 23 Nov 2026). On
 * credit: the bill is made out to the company, the guest can check out with the
 * balance still due, and the balance shows under Reports → Company dues until the
 * company pays (recorded as a normal payment on the booking). `reservation:modify`,
 * audited, `ReservationModified`.
 */
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";

const schema = z.object({ reservationId: z.string().min(1), corporateId: z.string().min(1).nullable() });

export async function setCompanyCredit(input: unknown): Promise<Result<{ corporateId: string | null }>> {
  return toResult(async () => {
    const { reservationId, corporateId } = schema.parse(input);
    const user = await requireUser();
    const scoped = db.scoped(user);
    const r = await scoped.reservation.findFirst({ where: { id: reservationId }, select: { id: true, propertyId: true, corporateId: true } });
    if (!r) throw new NotFoundError("Booking not found.");
    authorize(user, "reservation:modify", r.propertyId);
    if (corporateId) {
      const c = await scoped.corporate.findFirst({ where: { id: corporateId, orgId: user.orgId }, select: { id: true } });
      if (!c) throw new NotFoundError("Company not found.");
    }
    return runWithContext(
      { orgId: user.orgId, userId: user.userId, propertyScope: user.propertyScope, activePropertyId: user.activePropertyId, requestId: newRequestId(), ip: null, device: null },
      () => scoped.$transaction(async (tx) => {
        await tx.reservation.updateMany({ where: { id: r.id }, data: { corporateId } });
        await emitEvent(tx, { type: "ReservationModified", aggregateId: r.id, propertyId: r.propertyId, payload: { field: "companyCredit", corporateId } });
        await writeAudit(tx, { action: "reservation:company-credit", entityType: "Reservation", entityId: r.id, propertyId: r.propertyId, before: { corporateId: r.corporateId }, after: { corporateId } });
        return { corporateId };
      }),
    );
  });
}
