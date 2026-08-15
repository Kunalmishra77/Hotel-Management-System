"use server";
/**
 * Assets & equipment actions (architecture v2 · Phase 5). Register an asset and
 * change its operational status. Canonical path: validate → authorize
 * (maintenance:manage, property-scoped) → tx → emit event + audit.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { db } from "@/lib/db";
import { runWithContext, newRequestId } from "@/lib/context";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { NotFoundError } from "@/lib/errors";
import { type Result, toResult } from "@/lib/result";
import { createAssetSchema, updateAssetStatusSchema } from "./schema";

function ctxFor(user: { orgId: string; userId: string; propertyScope: import("@/lib/context").PropertyScope }, propertyId: string) {
  return { orgId: user.orgId, userId: user.userId, propertyScope: user.propertyScope, activePropertyId: propertyId, requestId: newRequestId(), ip: null, device: null };
}

export async function createAsset(input: unknown): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const data = createAssetSchema.parse(input);
    const user = await requireUser();
    const propertyId = user.activePropertyId ?? user.accessiblePropertyIds[0];
    if (!propertyId) throw new NotFoundError("No property in scope.");
    authorize(user, "maintenance:manage", propertyId);

    const warrantyUntil = data.warrantyUntil ? new Date(data.warrantyUntil) : null;

    return runWithContext(ctxFor(user, propertyId), () =>
      db.unscoped().$transaction(async (tx) => {
        const row = await tx.asset.create({
          data: {
            propertyId, name: data.name, category: data.category,
            location: data.location ?? null, serialNo: data.serialNo ?? null,
            warrantyUntil: warrantyUntil && !isNaN(warrantyUntil.getTime()) ? warrantyUntil : null,
            notes: data.notes ?? null,
          },
          select: { id: true },
        });
        await emitEvent(tx, { type: "AssetRegistered", aggregateId: row.id, propertyId, payload: { name: data.name, category: data.category } });
        await writeAudit(tx, { action: "asset:register", entityType: "Asset", entityId: row.id, propertyId, after: { name: data.name, category: data.category } });
        return { id: row.id };
      }),
    );
  });
}

export async function updateAssetStatus(input: unknown): Promise<Result<{ status: string }>> {
  return toResult(async () => {
    const data = updateAssetStatusSchema.parse(input);
    const user = await requireUser();
    const asset = await db.unscoped().asset.findUnique({ where: { id: data.assetId }, select: { id: true, propertyId: true, status: true } });
    if (!asset) throw new NotFoundError("Asset not found.");
    authorize(user, "maintenance:manage", asset.propertyId);

    return runWithContext(ctxFor(user, asset.propertyId), () =>
      db.unscoped().$transaction(async (tx) => {
        await tx.asset.update({ where: { id: asset.id }, data: { status: data.status } });
        await emitEvent(tx, { type: "AssetStatusChanged", aggregateId: asset.id, propertyId: asset.propertyId, payload: { status: data.status } });
        await writeAudit(tx, { action: "asset:status", entityType: "Asset", entityId: asset.id, propertyId: asset.propertyId, before: { status: asset.status }, after: { status: data.status } });
        return { status: data.status };
      }),
    );
  });
}
