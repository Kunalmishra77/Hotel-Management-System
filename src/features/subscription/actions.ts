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

const changePlanSchema = z.object({ plan: z.enum(["CORE", "GROWTH", "ENTERPRISE"]) });

/**
 * Change the org's plan (architecture v2 · SaaS). Sets the tier + bundled add-on
 * modules and activates it. In production this is gated behind a payment/mandate on
 * the recurring-billing gateway (a live-onboarding step, like OTA/DLT — see
 * integrations.md); here it applies immediately for a self-serve upgrade.
 */
export async function changePlan(raw: unknown): Promise<Result<{ plan: string }>> {
  return toResult(async () => {
    const { plan } = changePlanSchema.parse(raw);
    const { PLAN_BY_ID } = await import("./plans");
    const user = await requireUser();
    authorize(user, "settings:manage", user.activePropertyId);

    const bundled = PLAN_BY_ID[plan]?.bundledAddons ?? [];
    const renews = new Date();
    renews.setMonth(renews.getMonth() + 1);

    const ctx = { orgId: user.orgId, userId: user.userId, propertyScope: user.propertyScope, activePropertyId: user.activePropertyId, requestId: newRequestId(), ip: null, device: null };
    await runWithContext(ctx, () =>
      db.unscoped().$transaction(async (tx) => {
        await tx.organization.update({
          where: { id: user.orgId },
          data: { plan, planStatus: "ACTIVE", planRenewsAt: renews, addonModules: [...bundled] },
        });
        await writeAudit(tx, { action: "org:plan-change", entityType: "Organization", entityId: user.orgId, after: { plan } });
      }),
    );
    return { plan };
  });
}

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
