"use server";

/**
 * Booking-engine staff configuration — 23 T-17b (FR-17, AC-19). These are the
 * ONLY authenticated actions in the module: editing deposit/stay/cancel policy,
 * the gateway, the sellable categories, and publishing the site. All are gated on
 * `bookingengine:manage` (🔒 audited). The public book/pay flow stays
 * unauthenticated (see public.ts). The rest of the module has no user.
 */
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { newRequestId, runWithContext } from "@/lib/context";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { updateConfigSchema, publishSchema } from "./schema";
import type { SessionClaims } from "@/lib/auth/claims";

function withContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
  return runWithContext(
    {
      orgId: user.orgId,
      userId: user.userId,
      propertyScope: user.propertyScope,
      activePropertyId: user.activePropertyId,
      requestId: newRequestId(),
      ip: null,
      device: null,
    },
    fn,
  );
}

export type ConfigResult = { propertyId: string; slug: string; isPublished: boolean };

/** Create/update a property's booking-engine config. Requires `bookingengine:manage`. 🔒 */
export async function updateBookingEngineConfig(input: unknown): Promise<Result<ConfigResult>> {
  return toResult(async () => {
    const data = updateConfigSchema.parse(input);
    const user = await requireUser();
    authorize(user, "bookingengine:manage", data.propertyId);
    const prisma = db.unscoped();

    const existing = await prisma.bookingEngineConfig.findUnique({ where: { propertyId: data.propertyId } });
    // A slug is required to create; default it from the property code if absent.
    const slug =
      data.slug ??
      existing?.slug ??
      (await prisma.property.findUniqueOrThrow({ where: { id: data.propertyId }, select: { code: true } })).code.toLowerCase();

    const patch = {
      ...(data.slug !== undefined ? { slug: data.slug } : {}),
      ...(data.onlineSellableCategoryIds !== undefined ? { onlineSellableCategoryIds: data.onlineSellableCategoryIds } : {}),
      ...(data.depositPolicy !== undefined ? { depositPolicy: data.depositPolicy } : {}),
      ...(data.depositValue !== undefined ? { depositValue: data.depositValue } : {}),
      ...(data.checkoutTtlMin !== undefined ? { checkoutTtlMin: data.checkoutTtlMin } : {}),
      ...(data.minLos !== undefined ? { minLos: data.minLos } : {}),
      ...(data.maxLos !== undefined ? { maxLos: data.maxLos } : {}),
      ...(data.leadTimeDays !== undefined ? { leadTimeDays: data.leadTimeDays } : {}),
      ...(data.maxRoomsPerBooking !== undefined ? { maxRoomsPerBooking: data.maxRoomsPerBooking } : {}),
      ...(data.cancelWindowHours !== undefined ? { cancelWindowHours: data.cancelWindowHours } : {}),
      ...(data.gatewayProvider !== undefined ? { gatewayProvider: data.gatewayProvider } : {}),
    };

    return withContext(user, () =>
      prisma.$transaction(async (tx) => {
        let row;
        try {
          row = await tx.bookingEngineConfig.upsert({
            where: { propertyId: data.propertyId },
            create: { propertyId: data.propertyId, slug, ...patch },
            update: patch,
            select: { propertyId: true, slug: true, isPublished: true },
          });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            throw new ConflictError("That public link (slug) is already in use.");
          }
          throw e;
        }
        await emitEvent(tx, { type: "PropertyUpdated", aggregateId: data.propertyId, propertyId: data.propertyId, payload: { bookingEngine: "config-updated" } });
        await writeAudit(tx, {
          action: "bookingengine:config-update", entityType: "BookingEngineConfig", entityId: row.propertyId,
          propertyId: data.propertyId, reason: "Booking-site configuration change", after: { ...patch, slug: row.slug },
        });
        revalidatePath("/booking-site");
        return row;
      }),
    );
  });
}

/** Publish / unpublish the public booking site. Requires `bookingengine:manage`. 🔒 */
export async function publishBookingSite(input: unknown): Promise<Result<ConfigResult>> {
  return toResult(async () => {
    const data = publishSchema.parse(input);
    const user = await requireUser();
    authorize(user, "bookingengine:manage", data.propertyId);
    const prisma = db.unscoped();

    const existing = await prisma.bookingEngineConfig.findUnique({ where: { propertyId: data.propertyId }, select: { propertyId: true } });
    if (!existing) throw new NotFoundError("Configure the booking site before publishing.");

    return withContext(user, () =>
      prisma.$transaction(async (tx) => {
        const row = await tx.bookingEngineConfig.update({
          where: { propertyId: data.propertyId },
          data: { isPublished: data.isPublished },
          select: { propertyId: true, slug: true, isPublished: true },
        });
        await emitEvent(tx, { type: "PropertyUpdated", aggregateId: data.propertyId, propertyId: data.propertyId, payload: { bookingEngine: data.isPublished ? "published" : "unpublished" } });
        await writeAudit(tx, {
          action: "bookingengine:publish", entityType: "BookingEngineConfig", entityId: row.propertyId,
          propertyId: data.propertyId, reason: data.isPublished ? "Publish booking site" : "Unpublish booking site", after: { isPublished: row.isPublished },
        });
        revalidatePath("/booking-site");
        return row;
      }),
    );
  });
}

/** Staff read of the current config (for the settings screen). */
export async function getBookingEngineConfig(propertyId: string): Promise<Result<Record<string, unknown> | null>> {
  return toResult(async () => {
    const user = await requireUser();
    authorize(user, "bookingengine:manage", propertyId);
    const cfg = await db.unscoped().bookingEngineConfig.findUnique({ where: { propertyId } });
    return cfg as Record<string, unknown> | null;
  });
}
