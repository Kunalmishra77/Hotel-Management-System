"use server";

/**
 * Dynamic-pricing actions — 24 T-6/T-8 (FR-2/3/6, AC-3/5/7/9). Canonical write
 * path: zod → requireUser → authorize(`pricing:approve`) → transaction → event
 * + audit → typed Result.
 *
 * Guardrail (FR-3): a human may only publish a rate INSIDE the category's
 * [floor, ceil]. An out-of-band `appliedPaise` is refused with
 * `RATE_OUT_OF_BOUNDS` — an out-of-bounds rate is never published (AC-7). The
 * suggestion engine, by contrast, CLAMPS (domain/suggest); the human path
 * rejects, so the approver sees the guardrail rather than a silently-moved rate.
 *
 * Concurrency (AC-9): the SUGGESTED→APPROVED transition is a conditional
 * `updateMany` on `status: "SUGGESTED"`. Two concurrent approvals of the same
 * (category, date) — one unique row — leave exactly one APPROVED; the loser
 * matches zero rows and is rejected, so the event/publish fires exactly once.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { pricingDb, withPricingContext } from "./internal";
import { withinGuardrail } from "./domain/suggest";
import { approveRateSchema, rejectRateSchema } from "./schema";

export type ApproveRateResult = { id: string; status: string; appliedPaise: number };
export type RejectRateResult = { id: string; status: string };

/**
 * Approve a SUGGESTED rate at `appliedPaise` and publish it (FR-2/3, AC-3/7/9).
 * Emits `DynamicRateApproved` — 13 pushes to OTAs and 03/23 resolve to it.
 */
export async function approveRate(input: unknown): Promise<Result<ApproveRateResult>> {
  return toResult(async () => {
    const { dynamicRateId, appliedPaise } = approveRateSchema.parse(input);
    const user = await requireUser();
    const client = pricingDb(user);

    const rate = await client.dynamicRate.findFirst({
      where: { id: dynamicRateId },
      select: { id: true, propertyId: true, roomCategoryId: true, status: true, suggestedPaise: true },
    });
    if (!rate) throw new NotFoundError("Suggested rate not found.");
    authorize(user, "pricing:approve", rate.propertyId);

    // Guardrail is the category's [floor, ceil] (FR-3). Read it before deciding.
    const category = await client.roomCategory.findFirst({
      where: { id: rate.roomCategoryId, propertyId: rate.propertyId },
      select: { floorPaise: true, ceilPaise: true },
    });
    if (!category) throw new NotFoundError("Room category not found.");

    if (!withinGuardrail(appliedPaise, category.floorPaise, category.ceilPaise)) {
      throw new DomainError(ErrorCode.RATE_OUT_OF_BOUNDS, "Applied rate is outside the category guardrail.", {
        appliedPaise,
        floorPaise: category.floorPaise,
        ceilPaise: category.ceilPaise,
      });
    }

    return withPricingContext(user, () =>
      client.$transaction(async (tx) => {
        // Conditional on SUGGESTED so a concurrent approval can't double-publish (AC-9).
        const updated = await tx.dynamicRate.updateMany({
          where: { id: dynamicRateId, status: "SUGGESTED" },
          data: { status: "APPROVED", appliedPaise, approvedById: user.userId },
        });
        if (updated.count === 0) {
          throw new DomainError(ErrorCode.CONFLICT, "This rate has already been decided.");
        }

        await emitEvent(tx, {
          type: "DynamicRateApproved",
          aggregateId: dynamicRateId,
          propertyId: rate.propertyId,
          payload: { roomCategoryId: rate.roomCategoryId, appliedPaise },
        });
        await writeAudit(tx, {
          action: "pricing:approve",
          entityType: "DynamicRate",
          entityId: dynamicRateId,
          propertyId: rate.propertyId,
          before: { status: rate.status, suggestedPaise: rate.suggestedPaise },
          after: { status: "APPROVED", appliedPaise },
        });

        return { id: dynamicRateId, status: "APPROVED", appliedPaise };
      }),
    );
  });
}

/** Reject a SUGGESTED rate with a reason (FR-2, AC-5). Emits `DynamicRateRejected`. */
export async function rejectRate(input: unknown): Promise<Result<RejectRateResult>> {
  return toResult(async () => {
    const { dynamicRateId, reason } = rejectRateSchema.parse(input);
    const user = await requireUser();
    const client = pricingDb(user);

    const rate = await client.dynamicRate.findFirst({
      where: { id: dynamicRateId },
      select: { id: true, propertyId: true, roomCategoryId: true, status: true },
    });
    if (!rate) throw new NotFoundError("Suggested rate not found.");
    authorize(user, "pricing:approve", rate.propertyId, { reason });

    return withPricingContext(user, () =>
      client.$transaction(async (tx) => {
        const updated = await tx.dynamicRate.updateMany({
          where: { id: dynamicRateId, status: "SUGGESTED" },
          data: { status: "REJECTED", reason },
        });
        if (updated.count === 0) {
          throw new DomainError(ErrorCode.CONFLICT, "This rate has already been decided.");
        }

        await emitEvent(tx, {
          type: "DynamicRateRejected",
          aggregateId: dynamicRateId,
          propertyId: rate.propertyId,
          payload: { roomCategoryId: rate.roomCategoryId, reason },
        });
        await writeAudit(tx, {
          action: "pricing:reject",
          entityType: "DynamicRate",
          entityId: dynamicRateId,
          propertyId: rate.propertyId,
          reason,
          before: { status: rate.status },
          after: { status: "REJECTED" },
        });

        return { id: dynamicRateId, status: "REJECTED" };
      }),
    );
  });
}
