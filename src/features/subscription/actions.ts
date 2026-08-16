"use server";
/**
 * White-label branding (architecture v2 · SaaS). The org admin sets the brand name
 * + accent shown inside their tenant's app. `settings:manage` + audited.
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { runWithContext, newRequestId } from "@/lib/context";
import { toResult, type Result } from "@/lib/result";

const brandingSchema = z.object({
  brandName: z.string().trim().max(60).optional(),
  brandColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #1F5C46").optional().or(z.literal("")),
});

export async function setBranding(raw: unknown): Promise<Result<{ ok: true }>> {
  return toResult(async () => {
    const data = brandingSchema.parse(raw);
    const user = await requireUser();
    authorize(user, "settings:manage", user.activePropertyId);

    const ctx = { orgId: user.orgId, userId: user.userId, propertyScope: user.propertyScope, activePropertyId: user.activePropertyId, requestId: newRequestId(), ip: null, device: null };
    await runWithContext(ctx, () =>
      db.unscoped().$transaction(async (tx) => {
        await tx.organization.update({
          where: { id: user.orgId },
          data: {
            brandName: data.brandName?.trim() || null,
            brandColor: data.brandColor ? data.brandColor : null,
          },
        });
        await writeAudit(tx, { action: "org:branding", entityType: "Organization", entityId: user.orgId, after: { brandName: data.brandName ?? null } });
      }),
    );
    return { ok: true as const };
  });
}
