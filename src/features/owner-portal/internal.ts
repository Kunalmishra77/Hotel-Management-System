/**
 * Shared internals for owner-portal actions. NOT a "use server" module.
 * Scoped-db accessor + the request-context wrapper (audit/event actor). Owner
 * data is property-scoped, so the scoped client filters every read/write.
 */
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";
import { can } from "@/lib/permissions";
import type { SessionClaims } from "@/lib/auth/claims";

export function ownerDb(user: SessionClaims) {
  return db.scoped(user);
}

export function withOwnerContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
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

/** OWNER when the caller is a property owner (drives uploadedByRole + delete rules). */
export function actorRole(user: SessionClaims): "OWNER" | "STAFF" {
  return can(user, "owner:view-financials") && !can(user, "owner:manage") ? "OWNER" : "STAFF";
}
