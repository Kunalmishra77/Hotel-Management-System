"use server";
/**
 * Staff decision on a guest add-on request (Wave 3). Reception ACCEPTs (the priced
 * charge posts to the folio, settle-to-folio) or DECLINEs (nothing posts). The
 * accept path reuses billing's self-contained `postFolioCharge` — the same money
 * path the POS settle uses — so GST / HSN / place-of-supply / event / audit are all
 * handled there; we never write a folio line ourselves.
 *
 * Concurrency: the request is CAS-claimed `REQUESTED → ACCEPTED` before the charge
 * posts (a losing racer gets CONFLICT), and reverted to REQUESTED if the charge
 * fails — so a request is charged at most once and a failed accept stays retryable.
 * Gate: `folio:charge` (money-adjacent); the charge only posts for an IN_HOUSE stay.
 */
import { NotFoundError, DomainError, ErrorCode } from "@/lib/errors";
import { type Result, toResult } from "@/lib/result";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { runWithContext, newRequestId } from "@/lib/context";
import { ensureFolio } from "@/features/billing";
import { postFolioCharge } from "@/features/billing/charge-actions";
import { canDecide, canPostAddOnCharge } from "./domain/upsell";

export type DecideAddOnResult = { status: "ACCEPTED" | "DECLINED" };

export async function decideAddOnRequest(id: string, decision: "ACCEPT" | "DECLINE"): Promise<Result<DecideAddOnResult>> {
  return toResult(async () => {
    const user = await requireUser();

    const req = await db.unscoped().addOnRequest.findUnique({
      where: { id },
      select: {
        id: true, status: true, propertyId: true, reservationId: true,
        nameSnapshot: true, unitPaise: true, quantity: true, chargeType: true,
        reservation: { select: { status: true } },
      },
    });
    if (!req) throw new NotFoundError("Add-on request not found.");
    authorize(user, "folio:charge", req.propertyId);

    const next = decision === "ACCEPT" ? "ACCEPTED" : "DECLINED";
    if (!canDecide(req.status, next)) {
      throw new DomainError(ErrorCode.ILLEGAL_TRANSITION, undefined, { publicMessage: "This request has already been handled." });
    }

    const ctx = {
      orgId: user.orgId, userId: user.userId, propertyScope: user.propertyScope,
      activePropertyId: req.propertyId, requestId: newRequestId(), ip: null, device: null,
    };

    if (decision === "DECLINE") {
      await runWithContext(ctx, () =>
        db.unscoped().$transaction(async (tx) => {
          const claimed = await tx.addOnRequest.updateMany({
            where: { id: req.id, status: "REQUESTED" },
            data: { status: "DECLINED", decidedById: user.userId, decidedAt: new Date() },
          });
          if (claimed.count === 0) throw new DomainError(ErrorCode.CONFLICT, undefined, { publicMessage: "This request has already been handled." });
          await writeAudit(tx, { action: "addon:decline", entityType: "AddOnRequest", entityId: req.id, propertyId: req.propertyId, after: { status: "DECLINED" } });
          await emitEvent(tx, { type: "AddOnDeclined", aggregateId: req.id, propertyId: req.propertyId, payload: { reservationId: req.reservationId } });
        }),
      );
      return { status: "DECLINED" };
    }

    // ACCEPT — the charge posts to the folio, which only exists for an active stay.
    if (!canPostAddOnCharge(req.reservation.status)) {
      throw new DomainError(ErrorCode.FOLIO_TARGET_INVALID, undefined, {
        publicMessage: "The guest isn't checked in yet — apply this add-on once they check in.",
      });
    }

    // Claim first so a concurrent accept can't double-charge; revert on failure.
    const claimed = await db.unscoped().addOnRequest.updateMany({
      where: { id: req.id, status: "REQUESTED" },
      data: { status: "ACCEPTED", decidedById: user.userId, decidedAt: new Date() },
    });
    if (claimed.count === 0) throw new DomainError(ErrorCode.CONFLICT, undefined, { publicMessage: "This request has already been handled." });

    try {
      const folioId = await ensureFolio(db.unscoped(), { reservationId: req.reservationId, propertyId: req.propertyId });
      const charge = await postFolioCharge({
        folioId,
        type: req.chargeType,
        description: `Add-on: ${req.nameSnapshot}`,
        quantity: req.quantity,
        unitPaise: req.unitPaise,
        // GST is derived from the charge type (the seeded catalog rates match the
        // type defaults). Per-add-on rate/HSN overrides aren't snapshotted onto the
        // request yet — a documented future increment.
      });
      if (!charge.ok) throw new DomainError(ErrorCode.FOLIO_TARGET_INVALID, charge.error.message, { publicMessage: charge.error.message });

      await runWithContext(ctx, () =>
        db.unscoped().$transaction(async (tx) => {
          await tx.addOnRequest.update({ where: { id: req.id }, data: { folioLineId: charge.data.lineId } });
          await writeAudit(tx, {
            action: "addon:accept", entityType: "AddOnRequest", entityId: req.id, propertyId: req.propertyId,
            after: { folioLineId: charge.data.lineId, amountPaise: charge.data.amountPaise },
          });
          await emitEvent(tx, {
            type: "AddOnAccepted", aggregateId: req.id, propertyId: req.propertyId,
            payload: { reservationId: req.reservationId, folioLineId: charge.data.lineId, amountPaise: charge.data.amountPaise },
          });
        }),
      );
      return { status: "ACCEPTED" };
    } catch (err) {
      // Charge failed — release the claim so reception can retry.
      await db.unscoped().addOnRequest.updateMany({
        where: { id: req.id, status: "ACCEPTED", folioLineId: null },
        data: { status: "REQUESTED", decidedById: null, decidedAt: null },
      });
      throw err;
    }
  });
}
