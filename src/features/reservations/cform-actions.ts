"use server";

/**
 * Form C / FRRO submission tracking — 03 T-35 (FR-26, AC-29/30).
 *
 * The C-Form is generated at check-in (`saveCForm`). This records that a
 * generated form was actually reported on the e-FRRO portal: `GENERATED →
 * SUBMITTED` plus the portal reference the staff paste back. We deliberately do
 * NOT auto-file to the Bureau of Immigration — that needs certified access (a
 * live blocker per integrations.md); this activates the register's tracking so a
 * property can see which foreign arrivals have been reported.
 *
 * The action never regenerates or mutates the PDF — it only stamps status + ref.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { reservationDb, withReservationContext } from "./internal";
import { markCFormSubmittedSchema } from "./schema";

export type CFormSubmitResult = { id: string; status: string; submissionRef: string };

export async function markCFormSubmitted(input: unknown): Promise<Result<CFormSubmitResult>> {
  return toResult(async () => {
    const data = markCFormSubmittedSchema.parse(input);
    const user = await requireUser();
    const client = reservationDb(user);

    const cform = await client.cForm.findFirst({
      where: { id: data.cformId },
      select: { id: true, propertyId: true, status: true, submissionRef: true, reservation: { select: { code: true } } },
    });
    if (!cform) throw new NotFoundError("Form C not found.");
    authorize(user, "checkin:perform", cform.propertyId);

    // Idempotent: re-recording the same reference on an already-submitted form is a
    // no-op, so a double-tap or a retry never writes a spurious audit/event.
    if (cform.status === "SUBMITTED" && cform.submissionRef === data.submissionRef) {
      return { id: cform.id, status: cform.status, submissionRef: data.submissionRef };
    }

    return withReservationContext(user, () =>
      client.$transaction(async (tx) => {
        const updated = await tx.cForm.update({
          where: { id: cform.id },
          data: { status: "SUBMITTED", submissionRef: data.submissionRef },
          select: { id: true, status: true, submissionRef: true },
        });
        await emitEvent(tx, {
          type: "CFormSubmitted",
          aggregateId: cform.id,
          propertyId: cform.propertyId,
          payload: { code: cform.reservation.code, submissionRef: data.submissionRef },
        });
        await writeAudit(tx, {
          action: "reservation:cform-submit",
          entityType: "CForm",
          entityId: cform.id,
          propertyId: cform.propertyId,
          before: { status: cform.status },
          after: { status: "SUBMITTED", submissionRef: data.submissionRef },
        });
        return { id: updated.id, status: updated.status, submissionRef: updated.submissionRef ?? data.submissionRef };
      }),
    );
  });
}
