import "server-only";
/**
 * Subscription reads (architecture v2 · SaaS). The caller's org plan + effective
 * add-on modules + property count (the billing unit). Org-level, admin-facing.
 */
import { cache } from "react";
import { db } from "@/lib/db";
import type { SessionClaims } from "@/lib/auth/claims";
import { effectiveAddons, type AddonId } from "./plans";

/**
 * The org row behind both reads below, fetched ONCE per request.
 *
 * `getBranding` and `getSubscription` are called together by the dashboard
 * layout and want different columns of the SAME row. Two `findUnique`s meant
 * two round trips to a database in another region for one row that cannot
 * change between them, so the select is the union of both callers' needs and
 * the read is memoised per request (see `lib/auth` for why per-request caching
 * is safe and why it must not be widened past the request).
 */
const getOrgShell = cache(async function getOrgShell(orgId: string) {
  return db.unscoped().organization.findUnique({
    where: { id: orgId },
    select: {
      name: true,
      brandName: true,
      brandColor: true,
      plan: true,
      planStatus: true,
      planRenewsAt: true,
      addonModules: true,
    },
  });
});

export type Subscription = {
  plan: string;
  planStatus: string;
  planRenewsAt: Date | null;
  addonModules: string[];
  effectiveAddons: AddonId[];
  propertyCount: number;
};

export type Branding = { orgName: string; brandName: string; brandColor: string | null };

/** The tenant's white-label brand (name + accent), falling back to the org name. */
export async function getBranding(orgId: string): Promise<Branding | null> {
  const org = await getOrgShell(orgId);
  if (!org) return null;
  return { orgName: org.name, brandName: org.brandName?.trim() || org.name, brandColor: org.brandColor };
}

export async function getSubscription(user: SessionClaims): Promise<Subscription | null> {
  // The count does not depend on the org row, so it shares the same round trip
  // rather than waiting for it. (It is issued even when the org turns out not to
  // exist — a wasted read in a case that cannot happen for a signed-in caller,
  // and the cheaper trade than a second sequential hop on every page load.)
  const [org, propertyCount] = await Promise.all([
    getOrgShell(user.orgId),
    db.unscoped().property.count({ where: { orgId: user.orgId, deletedAt: null, isActive: true } }),
  ]);
  if (!org) return null;
  return {
    plan: org.plan,
    planStatus: org.planStatus,
    planRenewsAt: org.planRenewsAt,
    addonModules: org.addonModules,
    effectiveAddons: effectiveAddons(org.plan, org.addonModules),
    propertyCount,
  };
}
