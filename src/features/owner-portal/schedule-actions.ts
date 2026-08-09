"use server";

/**
 * 27 owner-portal — important-date management (FR-9). Staff-only (owner:manage);
 * the owner views them but does not edit. Soft-deleted, audited.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { ownerDb, withOwnerContext } from "./internal";
import { createImportantDateSchema, deleteImportantDateSchema } from "./schema";

/** Normalize a date to UTC midnight (a @db.Date carries no time). */
function toDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function createImportantDate(input: unknown): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const data = createImportantDateSchema.parse(input);
    const user = await requireUser();
    authorize(user, "owner:manage", data.propertyId);

    return withOwnerContext(user, () =>
      ownerDb(user).$transaction(async (tx) => {
        const row = await tx.propertyImportantDate.create({
          data: {
            propertyId: data.propertyId,
            kind: data.kind,
            label: data.label,
            dueDate: toDateOnly(data.dueDate),
            notes: data.notes ?? null,
          },
          select: { id: true },
        });
        await emitEvent(tx, {
          type: "ImportantDateChanged",
          aggregateId: row.id,
          propertyId: data.propertyId,
          payload: { kind: data.kind, label: data.label, action: "created" },
        });
        await writeAudit(tx, {
          action: "owner:important-date-create",
          entityType: "PropertyImportantDate",
          entityId: row.id,
          propertyId: data.propertyId,
          after: { kind: data.kind, label: data.label, dueDate: toDateOnly(data.dueDate).toISOString().slice(0, 10) },
        });
        return row;
      }),
    );
  });
}

export async function deleteImportantDate(input: unknown): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const { dateId } = deleteImportantDateSchema.parse(input);
    const user = await requireUser();

    const row = await ownerDb(user).propertyImportantDate.findFirst({
      where: { id: dateId, deletedAt: null },
      select: { id: true, propertyId: true, kind: true, label: true },
    });
    if (!row) throw new NotFoundError("Important date not found.");
    authorize(user, "owner:manage", row.propertyId);

    return withOwnerContext(user, () =>
      ownerDb(user).$transaction(async (tx) => {
        await tx.propertyImportantDate.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
        await emitEvent(tx, {
          type: "ImportantDateChanged",
          aggregateId: row.id,
          propertyId: row.propertyId,
          payload: { kind: row.kind, label: row.label, action: "deleted" },
        });
        await writeAudit(tx, {
          action: "owner:important-date-delete",
          entityType: "PropertyImportantDate",
          entityId: row.id,
          propertyId: row.propertyId,
          before: { kind: row.kind, label: row.label },
        });
        return { id: row.id };
      }),
    );
  });
}
