"use server";

/**
 * Folio charges, discounts, reversals — 06 T-9/T-10/T-11 (FR-4/6/7, AC-3/4/6/7).
 * Append-only: a correction is a REVERSAL line, never an edit (the DB trigger
 * enforces it too). GST is computed from the resolved place of supply — property
 * state for on-premise types, so a Maharashtra bill-to still yields CGST+SGST.
 */
import { requireUser } from "@/lib/auth";
import { authorize, hasPermission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { gstBpsForCharge, hsnSacForCharge } from "@/lib/constants/gst";
import { computeGst, placeOfSupply } from "./domain/gst";
import { discountLine } from "./domain/money";
import { billingDb, loadFolioContext, withBillingContext } from "./internal";

/** Calendar-day number from a date's UTC parts (for the closed-date comparison). */
function dayNumber(d: Date): number {
  return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000);
}
import { postChargeSchema, applyDiscountSchema, reverseLineSchema } from "./schema";

export type ChargeResult = { lineId: string; amountPaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number };

/** Post a charge with its GST (FR-4, AC-3/4). Place of supply → property state for on-premise. */
export async function postFolioCharge(input: unknown): Promise<Result<ChargeResult>> {
  return toResult(async () => {
    const data = postChargeSchema.parse(input);
    const user = await requireUser();
    const client = billingDb(user);
    const ctx = await loadFolioContext(client, data.folioId);
    if (!ctx) throw new NotFoundError("Folio not found.");
    authorize(user, "folio:charge", ctx.propertyId);

    // FR-15 / AC-19: a charge back-dated before the open business date is refused;
    // the caller re-posts the adjustment to the current open date.
    const businessDate = data.businessDate ?? ctx.currentBusinessDate ?? new Date();
    if (ctx.currentBusinessDate && dayNumber(businessDate) < dayNumber(ctx.currentBusinessDate)) {
      throw new DomainError(ErrorCode.CLOSED_DATE_POSTING);
    }

    const amountPaise = data.unitPaise * data.quantity;
    const pos = placeOfSupply(data.type, ctx.propertyState, data.placeOfSupplyState ?? ctx.billToState);
    // An explicit override (POS passes the menu item's own rate — 19 R-35) wins;
    // otherwise the rate is derived from the charge type as before.
    const rateBps = data.taxRateBps ?? gstBpsForCharge(data.type, data.type === "ROOM" ? data.unitPaise : undefined);
    const gst = computeGst(amountPaise, rateBps, ctx.propertyState, pos);

    return withBillingContext(user, () =>
      client.$transaction(async (tx) => {
        const line = await tx.folioLine.create({
          data: {
            folioId: data.folioId,
            type: data.type,
            description: data.description,
            quantity: data.quantity,
            unitPaise: data.unitPaise,
            amountPaise: BigInt(amountPaise),
            taxRateBps: rateBps,
            cgstPaise: gst.cgstPaise,
            sgstPaise: gst.sgstPaise,
            igstPaise: gst.igstPaise,
            hsnSac: data.hsnSac ?? hsnSacForCharge(data.type),
            placeOfSupplyState: pos,
            businessDate,
            postedById: user.userId,
          },
          select: { id: true },
        });
        await emitEvent(tx, { type: "FolioCharged", aggregateId: data.folioId, propertyId: ctx.propertyId, payload: { lineId: line.id, type: data.type, amountPaise } });
        await writeAudit(tx, { action: "folio:charge", entityType: "FolioLine", entityId: line.id, propertyId: ctx.propertyId, after: { type: data.type, amountPaise } });
        return { lineId: line.id, amountPaise, cgstPaise: gst.cgstPaise, sgstPaise: gst.sgstPaise, igstPaise: gst.igstPaise };
      }),
    );
  });
}

/** Apply a discount (FR-6, AC-6): pre-tax by default; over-threshold needs folio:discount + audited override. */
export async function applyDiscount(input: unknown): Promise<Result<{ lineId: string }>> {
  return toResult(async () => {
    const data = applyDiscountSchema.parse(input);
    const user = await requireUser();
    const client = billingDb(user);
    const ctx = await loadFolioContext(client, data.folioId);
    if (!ctx) throw new NotFoundError("Folio not found.");
    authorize(user, "folio:charge", ctx.propertyId);

    const settings = await client.securitySettings.findFirst({ where: { orgId: user.orgId }, select: { discountThresholdPaise: true } });
    const threshold = settings?.discountThresholdPaise ?? 100_000;
    const overThreshold = data.amountPaise > threshold;
    if (overThreshold && !hasPermission(user, "folio:discount")) {
      throw new DomainError(ErrorCode.DISCOUNT_OVER_THRESHOLD);
    }

    const pos = placeOfSupply("ROOM", ctx.propertyState, ctx.billToState);
    const draft = discountLine(data.amountPaise, data.rateBps, ctx.propertyState, pos, data.mode);

    return withBillingContext(user, () =>
      client.$transaction(async (tx) => {
        const line = await tx.folioLine.create({
          data: {
            folioId: data.folioId,
            type: "DISCOUNT",
            description: data.reason,
            quantity: 1,
            unitPaise: draft.amountPaise,
            amountPaise: BigInt(draft.amountPaise),
            taxRateBps: draft.taxRateBps,
            cgstPaise: draft.cgstPaise,
            sgstPaise: draft.sgstPaise,
            igstPaise: draft.igstPaise,
            placeOfSupplyState: pos,
            businessDate: new Date(),
            postedById: user.userId,
          },
          select: { id: true },
        });
        await emitEvent(tx, { type: "DiscountApplied", aggregateId: data.folioId, propertyId: ctx.propertyId, payload: { lineId: line.id, amountPaise: draft.amountPaise, mode: data.mode } });
        await writeAudit(tx, {
          action: overThreshold ? "folio:discount-override" : "folio:discount",
          entityType: "FolioLine", entityId: line.id, propertyId: ctx.propertyId,
          reason: data.reason, after: { amountPaise: draft.amountPaise, mode: data.mode, override: overThreshold },
        });
        return { lineId: line.id };
      }),
    );
  });
}

/** Reverse a posted line (FR-7, AC-7): append a REVERSAL with negated amount + tax. */
export async function reverseFolioLine(input: unknown): Promise<Result<{ reversalLineId: string }>> {
  return toResult(async () => {
    const data = reverseLineSchema.parse(input);
    const user = await requireUser();
    const client = billingDb(user);

    const original = await client.folioLine.findFirst({
      where: { id: data.lineId },
      select: { id: true, folioId: true, type: true, description: true, amountPaise: true, unitPaise: true, taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true, placeOfSupplyState: true, folio: { select: { propertyId: true } } },
    });
    if (!original) throw new NotFoundError("Folio line not found.");
    authorize(user, "folio:charge", original.folio.propertyId);

    return withBillingContext(user, () =>
      client.$transaction(async (tx) => {
        const reversal = await tx.folioLine.create({
          data: {
            folioId: original.folioId,
            type: "REVERSAL",
            description: `Reversal: ${original.description} (${data.reason})`,
            quantity: 1,
            unitPaise: -original.unitPaise,
            amountPaise: -original.amountPaise, // BigInt negation
            taxRateBps: original.taxRateBps,
            cgstPaise: -original.cgstPaise,
            sgstPaise: -original.sgstPaise,
            igstPaise: -original.igstPaise,
            hsnSac: original.hsnSac,
            placeOfSupplyState: original.placeOfSupplyState,
            businessDate: new Date(),
            reversalOfId: original.id,
            postedById: user.userId,
          },
          select: { id: true },
        });
        await emitEvent(tx, { type: "FolioCharged", aggregateId: original.folioId, propertyId: original.folio.propertyId, payload: { lineId: reversal.id, type: "REVERSAL", reversalOfId: original.id } });
        await writeAudit(tx, { action: "folio:reverse", entityType: "FolioLine", entityId: reversal.id, propertyId: original.folio.propertyId, reason: data.reason, after: { reversalOfId: original.id } });
        return { reversalLineId: reversal.id };
      }),
    );
  });
}
