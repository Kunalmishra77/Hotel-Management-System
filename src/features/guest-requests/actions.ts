"use server";
/**
 * Staff action for the guest-request inbox (Phase 4). Advances a request's status
 * (forward-only). Permission-checked (`request:manage`) + property-scoped +
 * audited. The guest sees the new status in their in-room tracker.
 */
import { NotFoundError, DomainError, ErrorCode } from "@/lib/errors";
import { type Result, toResult } from "@/lib/result";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { runWithContext, newRequestId } from "@/lib/context";
import { NEXT_STATUSES } from "@/features/guest-account/domain/request-kind";

const RESOLVED = new Set(["DONE", "DECLINED"]);

export async function updateGuestRequestStatus(id: string, status: string): Promise<Result<{ status: string }>> {
  return toResult(async () => {
    const user = await requireUser();

    const req = await db.unscoped().guestRequest.findUnique({
      where: { id },
      select: { id: true, status: true, propertyId: true },
    });
    if (!req) throw new NotFoundError("Request not found.");

    authorize(user, "request:manage", req.propertyId);

    if (!(NEXT_STATUSES[req.status] ?? []).includes(status)) {
      throw new DomainError(ErrorCode.ILLEGAL_TRANSITION, undefined, {
        publicMessage: "That status change isn't allowed.",
      });
    }

    // Establish the request context writeAudit needs (actions have no ambient one).
    await runWithContext(
      { orgId: user.orgId, userId: user.userId, propertyScope: user.propertyScope, activePropertyId: req.propertyId, requestId: newRequestId(), ip: null, device: null },
      () =>
        db.unscoped().$transaction(async (tx) => {
          await tx.guestRequest.update({
            where: { id: req.id },
            data: { status, resolvedAt: RESOLVED.has(status) ? new Date() : null },
          });
          await writeAudit(tx, {
            action: "guestrequest:status",
            entityType: "GuestRequest",
            entityId: req.id,
            propertyId: req.propertyId,
            before: { status: req.status },
            after: { status },
          });
        }),
    );

    return { status };
  });
}
