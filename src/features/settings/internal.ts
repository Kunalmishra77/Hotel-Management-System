/**
 * Shared internals for org-settings actions (module 16). NOT a "use server"
 * module. `SecuritySettings` is keyed by orgId (org-level identity/config, not
 * property-scoped), so it uses the unscoped client, always constrained by orgId
 * and behind an `authorize(settings:manage)` check.
 */
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";
import { ForbiddenError } from "@/lib/errors";
import type { SessionClaims } from "@/lib/auth/claims";

export const settingsDb = db.unscoped();

/**
 * The org-wide security policy governs authentication for *every* role across
 * the whole org, so editing it requires org-wide scope — not merely
 * `settings:manage`, which a property-scoped Manager also holds. `ALL_IN_ORG`
 * is the Administrator boundary (FR-10). Deny-by-default: throws otherwise.
 */
export function assertOrgWide(user: SessionClaims): void {
  if (user.propertyScope.kind !== "ALL_IN_ORG") {
    throw new ForbiddenError("Org-wide scope required", { userId: user.userId });
  }
}

export function withSettingsContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
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
