"use server";

/**
 * Category + room actions — 02 T-6/T-7/T-10/T-11 (FR-1/2/3/8/10, AC-1/2/3/12/13).
 *
 * Canonical write path: validate → authorize → transaction → event + audit.
 * Status changes live in `status-actions.ts`, blocks in `block-actions.ts`.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import {
  createCategorySchema,
  createRoomSchema,
  deactivateRoomSchema,
  updateCategorySchema,
  updateRoomSchema,
} from "./schema";
import {
  CATEGORY_SELECT,
  ROOM_SELECT,
  isUniqueViolation,
  roomDb,
  withRoomContext,
} from "./internal";

export type CategorySummary = {
  id: string;
  name: string;
  baseRatePaise: number;
  maxAdults: number;
  maxChildren: number;
};

export type RoomSummary = {
  id: string;
  number: string;
  status: string;
  isActive: boolean;
};

/** Create a room category (FR-1, AC-1). */
export async function createCategory(input: unknown): Promise<Result<CategorySummary>> {
  return toResult(async () => {
    const data = createCategorySchema.parse(input);
    const user = await requireUser();
    // AC-12: Housekeeping holds no `room:manage`, so this throws for them.
    authorize(user, "room:manage", data.propertyId);

    return withRoomContext(user, () =>
      roomDb(user).$transaction(async (tx) => {
        let category;
        try {
          category = await tx.roomCategory.create({
            data: {
              propertyId: data.propertyId,
              name: data.name,
              baseRatePaise: data.baseRatePaise,
              maxAdults: data.maxAdults,
              maxChildren: data.maxChildren,
              hsnSac: data.hsnSac ?? null,
              floorPaise: data.floorPaise ?? null,
              ceilPaise: data.ceilPaise ?? null,
              gstBps: data.gstBps,
            },
            select: CATEGORY_SELECT,
          });
        } catch (e) {
          if (isUniqueViolation(e)) {
            throw new ConflictError(`A category named "${data.name}" already exists here.`);
          }
          throw e;
        }

        await emitEvent(tx, {
          type: "CategoryCreated",
          aggregateId: category.id,
          propertyId: data.propertyId,
          payload: { name: category.name, baseRatePaise: category.baseRatePaise },
        });
        await writeAudit(tx, {
          action: "room:create-category",
          entityType: "RoomCategory",
          entityId: category.id,
          propertyId: data.propertyId,
          after: { name: category.name, baseRatePaise: category.baseRatePaise },
        });

        revalidatePath("/rooms");
        return category;
      }),
    );
  });
}

/**
 * Edit a category (FR-1).
 *
 * design.md § Edge cases: a rate change does NOT retro-change existing
 * reservations — they snapshot their rate at booking (03/06). Nothing here
 * touches a reservation, which is what makes that true.
 */
export async function updateCategory(input: unknown): Promise<Result<CategorySummary>> {
  return toResult(async () => {
    const { id, propertyId: _ignored, ...changes } = updateCategorySchema.parse(input);
    const user = await requireUser();

    const scoped = roomDb(user);
    const existing = await scoped.roomCategory.findFirst({
      where: { id },
      select: { propertyId: true, name: true, baseRatePaise: true },
    });
    if (!existing) throw new NotFoundError("Category not found");

    authorize(user, "room:manage", existing.propertyId);

    return withRoomContext(user, () =>
      scoped.$transaction(async (tx) => {
        let updated;
        try {
          updated = await tx.roomCategory.update({
            where: { id },
            data: changes,
            select: CATEGORY_SELECT,
          });
        } catch (e) {
          if (isUniqueViolation(e)) {
            throw new ConflictError(`A category named "${changes.name}" already exists here.`);
          }
          throw e;
        }

        await writeAudit(tx, {
          action: "room:update-category",
          entityType: "RoomCategory",
          entityId: id,
          propertyId: existing.propertyId,
          before: { name: existing.name, baseRatePaise: existing.baseRatePaise },
          after: changes,
        });

        revalidatePath("/rooms");
        return updated;
      }),
    );
  });
}

/** Create a room (FR-2/3, AC-2/3). */
export async function createRoom(input: unknown): Promise<Result<RoomSummary>> {
  return toResult(async () => {
    const data = createRoomSchema.parse(input);
    const user = await requireUser();
    authorize(user, "room:manage", data.propertyId);

    return withRoomContext(user, () =>
      roomDb(user).$transaction(async (tx) => {
        let room;
        try {
          room = await tx.room.create({
            data: {
              propertyId: data.propertyId,
              categoryId: data.categoryId,
              floorId: data.floorId ?? null,
              number: data.number,
              // AC-2: a new room starts VACANT — the schema default, stated
              // explicitly because the AC asserts it.
              status: "VACANT",
            },
            select: ROOM_SELECT,
          });
        } catch (e) {
          // FR-3 / AC-3 — the DB unique constraint decides, so two concurrent
          // creates of "101" cannot both win.
          if (isUniqueViolation(e, "number")) {
            throw new ConflictError(`Room "${data.number}" already exists in this property.`);
          }
          throw e;
        }

        await emitEvent(tx, {
          type: "RoomCreated",
          aggregateId: room.id,
          propertyId: data.propertyId,
          payload: { number: room.number, categoryId: data.categoryId },
        });
        await writeAudit(tx, {
          action: "room:create",
          entityType: "Room",
          entityId: room.id,
          propertyId: data.propertyId,
          after: { number: room.number, status: room.status },
        });

        revalidatePath("/rooms");
        return room;
      }),
    );
  });
}

/** Edit a room (FR-2/3). */
export async function updateRoom(input: unknown): Promise<Result<RoomSummary>> {
  return toResult(async () => {
    const { id, ...changes } = updateRoomSchema.parse(input);
    const user = await requireUser();

    const scoped = roomDb(user);
    const existing = await scoped.room.findFirst({
      where: { id },
      select: { propertyId: true, number: true, categoryId: true, floorId: true },
    });
    if (!existing) throw new NotFoundError("Room not found");

    authorize(user, "room:manage", existing.propertyId);

    return withRoomContext(user, () =>
      scoped.$transaction(async (tx) => {
        let updated;
        try {
          updated = await tx.room.update({ where: { id }, data: changes, select: ROOM_SELECT });
        } catch (e) {
          if (isUniqueViolation(e, "number")) {
            throw new ConflictError(`Room "${changes.number}" already exists in this property.`);
          }
          throw e;
        }

        await writeAudit(tx, {
          action: "room:update",
          entityType: "Room",
          entityId: id,
          propertyId: existing.propertyId,
          before: existing,
          after: changes,
        });

        revalidatePath("/rooms");
        return updated;
      }),
    );
  });
}

/**
 * Deactivate a room (FR-8, AC-13).
 *
 * Excluded from availability and new allocations but retained in history.
 * design.md § Edge cases: blocked while a future reservation exists — those
 * guests must be moved or cancelled first, not silently stranded.
 */
export async function deactivateRoom(input: unknown): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const data = deactivateRoomSchema.parse(input);
    const user = await requireUser();

    const scoped = roomDb(user);
    const room = await scoped.room.findFirst({
      where: { id: data.id },
      select: { propertyId: true, number: true, isActive: true },
    });
    if (!room) throw new NotFoundError("Room not found");

    authorize(user, "room:manage", room.propertyId);

    return withRoomContext(user, () =>
      scoped.$transaction(async (tx) => {
        const futureAllocations = await tx.roomAllocation.count({
          where: { roomId: data.id, endDate: { gte: new Date() } },
        });
        if (futureAllocations > 0) {
          throw new ConflictError(
            `Room ${room.number} has ${futureAllocations} current or future reservation` +
              `${futureAllocations === 1 ? "" : "s"}. Move or cancel them first.`,
          );
        }

        await tx.room.update({ where: { id: data.id }, data: { isActive: false } });

        await writeAudit(tx, {
          action: "room:deactivate",
          entityType: "Room",
          entityId: data.id,
          propertyId: room.propertyId,
          reason: data.reason ?? null,
          before: { isActive: true },
          after: { isActive: false },
        });

        revalidatePath("/rooms");
        return { id: data.id };
      }),
    );
  });
}
