import "server-only";
/**
 * Subscription reads (architecture v2 · SaaS). The caller's org plan + effective
 * add-on modules + property count (the billing unit). Org-level, admin-facing.
 */
import { db } from "@/lib/db";
import type { SessionClaims } from "@/lib/auth/claims";
import { effectiveAddons, type AddonId } from "./plans";

export type Subscription = {
  plan: string;
  planStatus: string;
  planRenewsAt: Date | null;
  addonModules: string[];
  effectiveAddons: AddonId[];
  propertyCount: number;
};

export async function getSubscription(user: SessionClaims): Promise<Subscription | null> {
  const org = await db.unscoped().organization.findUnique({
    where: { id: user.orgId },
    select: { plan: true, planStatus: true, planRenewsAt: true, addonModules: true },
  });
  if (!org) return null;
  const propertyCount = await db.unscoped().property.count({ where: { orgId: user.orgId, deletedAt: null, isActive: true } });
  return {
    plan: org.plan,
    planStatus: org.planStatus,
    planRenewsAt: org.planRenewsAt,
    addonModules: org.addonModules,
    effectiveAddons: effectiveAddons(org.plan, org.addonModules),
    propertyCount,
  };
}
