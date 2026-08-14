"use server";
/**
 * Lost & Found actions (Phase 7). Housekeeping logs a guest's forgotten item and
 * later resolves it (claimed/disposed). Server-authorized (`housekeeping:update`),
 * property-scoped to the caller's active property, audited.
 */
import { DomainError, ErrorCode } from "@/lib/errors";
import { type Result, toResult } from "@/lib/result";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { runWithContext, newRequestId } from "@/lib/context";
import type { SessionClaims } from "@/lib/auth/claims";
import { isResolvable } from "./domain/status";
import { logLostItemSchema, resolveLostItemSchema } from "./schema";

/** Establish the request context an action's audit/events need (no ambient one). */
function withCtx<T>(user: SessionClaims, propertyId: string, fn: () => Promise<T>): Promise<T> {
  return runWithContext(
    { orgId: user.orgId, userId: user.userId, propertyScope: user.propertyScope, activePropertyId: propertyId, requestId: newRequestId(), ip: null, device: null },
    fn,
  );
}

export type LostItemResult = { id: string };

export async function logLostItem(input: unknown): Promise<Result<LostItemResult>> {
  return toResult(async () => {
    const data = logLostItemSchema.parse(input);
    const user = await requireUser();
    const propertyId = db.activeProperty(user);
    authorize(user, "housekeeping:update", propertyId);

    const roomId = data.roomNumber
      ? (await db.unscoped().room.findFirst({ where: { propertyId, number: data.roomNumber }, select: { id: true } }))?.id ?? null
      : null;

    const id = await withCtx(user, propertyId, () => db.unscoped().$transaction(async (tx) => {
      const row = await tx.lostAndFoundItem.create({
        data: {
          orgId: user.orgId,
          propertyId,
          roomId,
          description: data.description,
          foundOn: data.foundOn,
          foundByStaffId: user.userId,
          notes: data.notes ?? null,
        },
        select: { id: true },
      });
      await writeAudit(tx, {
        action: "lostfound:log",
        entityType: "LostAndFoundItem",
        entityId: row.id,
        propertyId,
        after: { description: data.description },
      });
      return row.id;
    }));

    return { id };
  });
}

export async function resolveLostItem(input: unknown): Promise<Result<LostItemResult>> {
  return toResult(async () => {
    const data = resolveLostItemSchema.parse(input);
    const user = await requireUser();

    const item = await db
      .unscoped()
      .lostAndFoundItem.findUnique({ where: { id: data.id }, select: { id: true, propertyId: true, status: true } });
    if (!item) throw new DomainError(ErrorCode.NOT_FOUND, "Item not found.");
    authorize(user, "housekeeping:update", item.propertyId);
    if (!isResolvable(item.status)) {
      throw new DomainError(ErrorCode.ILLEGAL_TRANSITION, undefined, { publicMessage: "This item is already resolved." });
    }

    await withCtx(user, item.propertyId, () => db.unscoped().$transaction(async (tx) => {
      await tx.lostAndFoundItem.update({
        where: { id: item.id },
        data: { status: data.status, claimantName: data.claimantName ?? null, resolvedOn: new Date() },
      });
      await writeAudit(tx, {
        action: "lostfound:resolve",
        entityType: "LostAndFoundItem",
        entityId: item.id,
        propertyId: item.propertyId,
        before: { status: item.status },
        after: { status: data.status },
      });
    }));

    return { id: item.id };
  });
}
