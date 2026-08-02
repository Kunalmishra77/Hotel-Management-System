"use server";

/**
 * Platform server actions — 00 T-21 (FR-27, AC-25).
 *
 * Follows the canonical write path from design.md:
 *   validate (zod) → authorize → transaction → emit event → audit → typed Result
 */
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { setActiveProperty } from "@/lib/auth/session";
import { runWithContext, newRequestId } from "@/lib/context";
import { writeAudit } from "@/lib/audit";
import { OutOfScopeError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { switchPropertySchema } from "./schema";

/**
 * Unscoped by necessity: Session is a platform table with no propertyId, and
 * the Property read is already constrained to `claims.accessiblePropertyIds`
 * — the same set db.scoped() would filter by. `setActiveProperty` re-checks
 * scope before writing, so the boundary is enforced, just not by the client
 * extension.
 */
const prisma = db.unscoped();

export type PropertyOption = { id: string; name: string; code: string };

/**
 * Switch the session's active property (FR-27).
 *
 * Scope is re-validated server-side: a user must never be able to point their
 * session at a property outside `accessiblePropertyIds`, whatever the UI sent.
 *
 * No domain event is emitted — switching the property one is *looking at* is a
 * session preference, not a business state change, and the event catalogue in
 * docs/architecture/domain-events.md has no entry for it. It is still audited,
 * because "which property was this user working in" is exactly the context an
 * auditor needs to interpret later actions.
 */
export async function switchProperty(input: unknown): Promise<Result<{ activePropertyId: string }>> {
  return toResult(async () => {
    const data = switchPropertySchema.parse(input);
    const session = await requireSession();
    const { claims } = session;

    return runWithContext(
      {
        orgId: claims.orgId,
        userId: claims.userId,
        propertyScope: claims.propertyScope,
        activePropertyId: claims.activePropertyId,
        requestId: newRequestId(),
        ip: null,
        device: null,
      },
      async () => {
        const previous = claims.activePropertyId;

        const applied = await setActiveProperty(
          prisma,
          session.sessionId,
          data.propertyId,
          claims,
        );
        if (!applied) {
          throw new OutOfScopeError("Property outside caller scope", {
            propertyId: data.propertyId,
          });
        }

        await prisma.$transaction((tx) =>
          writeAudit(tx, {
            action: "session:switch-property",
            entityType: "Session",
            entityId: session.sessionId,
            propertyId: data.propertyId,
            before: { activePropertyId: previous },
            after: { activePropertyId: data.propertyId },
          }),
        );

        // Every scoped read downstream depends on the active property.
        revalidatePath("/", "layout");
        return { activePropertyId: data.propertyId };
      },
    );
  });
}

/**
 * The switcher's options — the caller's properties only (FR-27: "a property
 * switcher limited to the caller's property scope").
 */
export async function listAccessibleProperties(): Promise<PropertyOption[]> {
  const { claims } = await requireSession();
  if (claims.accessiblePropertyIds.length === 0) return [];

  return prisma.property.findMany({
    where: { id: { in: [...claims.accessiblePropertyIds] } },
    select: { id: true, name: true, code: true },
    orderBy: { code: "asc" },
  });
}
