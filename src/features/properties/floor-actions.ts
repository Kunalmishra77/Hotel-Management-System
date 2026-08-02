"use server";

/**
 * Floor server actions — 01 T-6 (FR-4, AC-4).
 * Split from `actions.ts` to keep both under the ~300-line limit.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { addFloorSchema, reorderFloorsSchema } from "./schema";
import { isUniqueViolation, propertyDb, withPropertyContext } from "./internal";

export type FloorSummary = { id: string; name: string; sortOrder: number };

/** Add a floor (FR-4, AC-4). */
export async function addFloor(input: unknown): Promise<Result<FloorSummary>> {
  return toResult(async () => {
    const data = addFloorSchema.parse(input);
    const user = await requireUser();
    authorize(user, "property:manage", data.propertyId);

    return withPropertyContext(user, () =>
      propertyDb.$transaction(async (tx) => {
        // Append to the end unless a position was given.
        const sortOrder =
          data.sortOrder ??
          ((
            await tx.floor.aggregate({
              where: { propertyId: data.propertyId },
              _max: { sortOrder: true },
            })
          )._max.sortOrder ?? -1) + 1;

        let floor;
        try {
          floor = await tx.floor.create({
            data: { propertyId: data.propertyId, name: data.name, sortOrder },
            select: { id: true, name: true, sortOrder: true },
          });
        } catch (e) {
          // AC-4: a duplicate "1" is rejected. The DB unique constraint decides,
          // so two concurrent adds cannot both win.
          if (isUniqueViolation(e)) {
            throw new ConflictError(`Floor "${data.name}" already exists for this property.`, {
              name: data.name,
            });
          }
          throw e;
        }

        await writeAudit(tx, {
          action: "property:add-floor",
          entityType: "Floor",
          entityId: floor.id,
          propertyId: data.propertyId,
          after: { name: floor.name, sortOrder: floor.sortOrder },
        });

        revalidatePath(`/properties/${data.propertyId}`);
        return floor;
      }),
    );
  });
}

/** Reorder floors (FR-4). */
export async function reorderFloors(input: unknown): Promise<Result<{ count: number }>> {
  return toResult(async () => {
    const data = reorderFloorsSchema.parse(input);
    const user = await requireUser();
    authorize(user, "property:manage", data.propertyId);

    return withPropertyContext(user, () =>
      propertyDb.$transaction(async (tx) => {
        // Only reorder floors that actually belong to this property — an id
        // from elsewhere must not be silently re-parented.
        const owned = await tx.floor.findMany({
          where: { propertyId: data.propertyId, id: { in: data.floorIds } },
          select: { id: true },
        });
        if (owned.length !== data.floorIds.length) {
          throw new NotFoundError("One or more floors do not belong to this property");
        }

        for (const [index, floorId] of data.floorIds.entries()) {
          await tx.floor.update({ where: { id: floorId }, data: { sortOrder: index } });
        }

        await writeAudit(tx, {
          action: "property:reorder-floors",
          entityType: "Property",
          entityId: data.propertyId,
          propertyId: data.propertyId,
          after: { order: data.floorIds },
        });

        revalidatePath(`/properties/${data.propertyId}`);
        return { count: data.floorIds.length };
      }),
    );
  });
}
