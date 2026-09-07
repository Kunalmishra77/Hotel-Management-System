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
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ensureFolio } from "@/features/billing";
import { postFolioCharge } from "@/features/billing/charge-actions";
import { getAddOn } from "./queries";
import { canDecide, canPostAddOnCharge } from "./domain/upsell";

export type DecideAddOnResult = { status: "ACCEPTED" | "DECLINED" };

const addAddOnSchema = z.object({
  reservationId: z.string().min(1),
  addOnId: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(50).default(1),
});

/**
 * Reception-initiated add-on (walk-up upsell) — staff post a catalog add-on
 * straight to a stay's folio, no guest request needed. Reuses billing's
 * `postFolioCharge` and passes the catalog item's HSN/tax overrides so GST is
 * correct. Gate `folio:charge`; only for an in-house stay.
 */
export async function addAddOnToReservation(input: unknown): Promise<Result<{ lineId: string }>> {
  return toResult(async () => {
    const data = addAddOnSchema.parse(input);
    const user = await requireUser();
    const reservation = await db.unscoped().reservation.findFirst({
      where: { id: data.reservationId, property: { orgId: user.orgId } },
      select: { id: true, status: true, propertyId: true },
    });
    if (!reservation) throw new NotFoundError("Reservation not found.");
    authorize(user, "folio:charge", reservation.propertyId);

    const addOn = await getAddOn(data.addOnId);
    if (!addOn || !addOn.active || addOn.propertyId !== reservation.propertyId) {
      throw new NotFoundError("Add-on not found for this property.");
    }
    if (!canPostAddOnCharge(reservation.status)) {
      throw new DomainError(ErrorCode.FOLIO_TARGET_INVALID, undefined, {
        publicMessage: "Add-ons post once the guest is checked in.",
      });
    }

    const folioId = await ensureFolio(db.unscoped(), { reservationId: reservation.id, propertyId: reservation.propertyId });
    const charge = await postFolioCharge({
      folioId,
      type: addOn.chargeType,
      description: `Add-on: ${addOn.name}`,
      quantity: data.quantity,
      unitPaise: addOn.pricePaise,
      ...(addOn.hsnSac ? { hsnSac: addOn.hsnSac } : {}),
      ...(addOn.taxRateBps != null ? { taxRateBps: addOn.taxRateBps } : {}),
    });
    if (!charge.ok) throw new DomainError(ErrorCode.FOLIO_TARGET_INVALID, charge.error.message, { publicMessage: charge.error.message });
    revalidatePath(`/bookings/${reservation.id}/folio`);
    return { lineId: charge.data.lineId };
  });
}

export async function decideAddOnRequest(id: string, decision: "ACCEPT" | "DECLINE"): Promise<Result<DecideAddOnResult>> {
  return toResult(async () => {
    const user = await requireUser();

    const req = await db.unscoped().addOnRequest.findUnique({
      where: { id },
      select: {
        id: true, status: true, propertyId: true, reservationId: true,
        nameSnapshot: true, unitPaise: true, quantity: true, chargeType: true,
        reservation: { select: { status: true } },
        addOn: { select: { hsnSac: true, taxRateBps: true } },
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
        // Honour the catalog item's GST/HSN overrides (read from the linked AddOn),
        // falling back to the charge-type defaults when it doesn't override.
        ...(req.addOn?.hsnSac ? { hsnSac: req.addOn.hsnSac } : {}),
        ...(req.addOn?.taxRateBps != null ? { taxRateBps: req.addOn.taxRateBps } : {}),
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
