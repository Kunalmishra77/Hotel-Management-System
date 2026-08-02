"use server";

/**
 * Property server actions — 01 T-5/T-7/T-9 (FR-1/2/3/5/9, AC-1/2/3/5/9/10).
 *
 * Canonical write path (design.md):
 *   validate (zod) → authorize → transaction → emit event → audit → Result
 *
 * Floor actions live in `floor-actions.ts`; shared helpers in `internal.ts`.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import {
  createPropertySchema,
  deactivatePropertySchema,
  updatePropertySchema,
} from "./schema";
import {
  PROPERTY_SUMMARY_SELECT,
  assertOrgWideScope,
  isUniqueViolation,
  propertyDb,
  withPropertyContext,
  type PropertySummary,
} from "./internal";

/** Create a property (FR-1/2/3/9, AC-1/2/3, AC-9/10). */
export async function createProperty(input: unknown): Promise<Result<PropertySummary>> {
  return toResult(async () => {
    const data = createPropertySchema.parse(input);
    const user = await requireUser();

    // No propertyId to scope by — this is an org-level action (see internal.ts).
    authorize(user, "property:manage");
    assertOrgWideScope(user);

    return withPropertyContext(user, () =>
      propertyDb.$transaction(async (tx) => {
        let created;
        try {
          // FR-2: let the DB unique constraint decide — a check-then-insert
          // loses to a concurrent create.
          created = await tx.property.create({
            data: {
              orgId: user.orgId,
              name: data.name,
              code: data.code,
              addressLine1: data.addressLine1,
              addressLine2: data.addressLine2 ?? null,
              city: data.city,
              state: data.state,
              country: data.country,
              pincode: data.pincode,
              timezone: data.timezone,
              gstin: data.gstin,
              ownerName: data.ownerName ?? null,
              ownerContact: data.ownerContact ?? null,
            },
            select: PROPERTY_SUMMARY_SELECT,
          });
        } catch (e) {
          if (isUniqueViolation(e, "code")) {
            throw new ConflictError(`Code "${data.code}" is already in use.`, { code: data.code });
          }
          throw e;
        }

        await emitEvent(tx, {
          type: "PropertyCreated",
          aggregateId: created.id,
          propertyId: created.id,
          payload: { code: created.code, name: created.name },
        });
        await writeAudit(tx, {
          action: "property:create",
          entityType: "Property",
          entityId: created.id,
          propertyId: created.id,
          after: { name: created.name, code: created.code, city: created.city },
        });

        revalidatePath("/properties");
        return created;
      }),
    );
  });
}

/** Edit a property (FR-1/2/3/9, AC-2/3). */
export async function updateProperty(input: unknown): Promise<Result<PropertySummary>> {
  return toResult(async () => {
    const { id, ...changes } = updatePropertySchema.parse(input);
    const user = await requireUser();

    // Scoped to the property being edited — a Manager may edit their own, not
    // somebody else's.
    authorize(user, "property:manage", id);

    return withPropertyContext(user, () =>
      propertyDb.$transaction(async (tx) => {
        const before = await tx.property.findFirst({
          where: { id, orgId: user.orgId, deletedAt: null },
          select: { name: true, code: true, city: true, state: true, gstin: true, timezone: true },
        });
        if (!before) throw new NotFoundError("Property not found");

        let updated;
        try {
          updated = await tx.property.update({
            where: { id },
            data: changes,
            select: PROPERTY_SUMMARY_SELECT,
          });
        } catch (e) {
          if (isUniqueViolation(e, "code")) {
            throw new ConflictError(`Code "${changes.code}" is already in use.`, {
              code: changes.code,
            });
          }
          throw e;
        }

        await emitEvent(tx, {
          type: "PropertyUpdated",
          aggregateId: id,
          propertyId: id,
          payload: { changed: Object.keys(changes) },
        });
        await writeAudit(tx, {
          action: "property:update",
          entityType: "Property",
          entityId: id,
          propertyId: id,
          before,
          after: changes,
        });

        revalidatePath("/properties");
        revalidatePath(`/properties/${id}`);
        return updated;
      }),
    );
  });
}

/**
 * Deactivate a property (FR-5/9, AC-5).
 *
 * Soft-delete only — historical reporting must still include it. Blocked while
 * guests are in-house (design.md § Edge cases): deactivating out from under a
 * live stay would strand the folio and the guest.
 */
export async function deactivateProperty(input: unknown): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const data = deactivatePropertySchema.parse(input);
    const user = await requireUser();
    authorize(user, "property:manage", data.id);

    return withPropertyContext(user, () =>
      propertyDb.$transaction(async (tx) => {
        const property = await tx.property.findFirst({
          where: { id: data.id, orgId: user.orgId },
          select: { id: true, name: true, isActive: true },
        });
        if (!property) throw new NotFoundError("Property not found");

        const inHouse = await tx.reservation.count({
          where: { propertyId: data.id, status: "IN_HOUSE" },
        });
        if (inHouse > 0) {
          throw new ConflictError(
            `${inHouse} guest${inHouse === 1 ? " is" : "s are"} still in-house. ` +
              "Check them out before deactivating this property.",
            { inHouse },
          );
        }

        await tx.property.update({
          where: { id: data.id },
          // isActive drives the booking pickers; deletedAt marks the soft
          // delete. The row is never removed — reports still need it (FR-5).
          data: { isActive: false, deletedAt: new Date() },
        });

        await emitEvent(tx, {
          type: "PropertyDeactivated",
          aggregateId: data.id,
          propertyId: data.id,
          payload: { name: property.name },
        });
        await writeAudit(tx, {
          action: "property:deactivate",
          entityType: "Property",
          entityId: data.id,
          propertyId: data.id,
          reason: data.reason ?? null,
          before: { isActive: true },
          after: { isActive: false },
        });

        revalidatePath("/properties");
        return { id: data.id };
      }),
    );
  });
}
