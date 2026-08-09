"use server";

/**
 * Field-staff tracking management — 09 addendum (FR-16). Enabling stamps a unique
 * tracking token (the driver's link credential) + flags the staff as field staff;
 * disabling clears both so the link stops working. `staff:manage`, audited.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { staffDb, withStaffContext } from "./internal";
import { fieldTrackingSchema } from "./schema";
import { generateTrackingToken } from "./field-internal";

export type FieldTrackingResult = { staffId: string; trackingToken: string | null };

export async function enableFieldTracking(input: unknown): Promise<Result<FieldTrackingResult>> {
  return toResult(async () => {
    const { staffId } = fieldTrackingSchema.parse(input);
    const user = await requireUser();
    const client = staffDb(user);
    const staff = await client.staff.findFirst({ where: { id: staffId }, select: { id: true, propertyId: true, trackingToken: true } });
    if (!staff) throw new NotFoundError("Staff not found.");
    authorize(user, "staff:manage", staff.propertyId);

    // Keep an existing token stable so a printed/shared link keeps working.
    const token = staff.trackingToken ?? generateTrackingToken();

    return withStaffContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.staff.updateMany({ where: { id: staffId }, data: { isFieldStaff: true, trackingToken: token } });
        await emitEvent(tx, { type: "FieldTrackingEnabled", aggregateId: staffId, propertyId: staff.propertyId, payload: {} });
        await writeAudit(tx, { action: "staff:field-tracking-enable", entityType: "Staff", entityId: staffId, propertyId: staff.propertyId, after: { isFieldStaff: true } });
        return { staffId, trackingToken: token };
      }),
    );
  });
}

export async function disableFieldTracking(input: unknown): Promise<Result<FieldTrackingResult>> {
  return toResult(async () => {
    const { staffId } = fieldTrackingSchema.parse(input);
    const user = await requireUser();
    const client = staffDb(user);
    const staff = await client.staff.findFirst({ where: { id: staffId }, select: { id: true, propertyId: true } });
    if (!staff) throw new NotFoundError("Staff not found.");
    authorize(user, "staff:manage", staff.propertyId);

    return withStaffContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.staff.updateMany({ where: { id: staffId }, data: { isFieldStaff: false, trackingToken: null } });
        await emitEvent(tx, { type: "FieldTrackingDisabled", aggregateId: staffId, propertyId: staff.propertyId, payload: {} });
        await writeAudit(tx, { action: "staff:field-tracking-disable", entityType: "Staff", entityId: staffId, propertyId: staff.propertyId, after: { isFieldStaff: false } });
        return { staffId, trackingToken: null };
      }),
    );
  });
}
