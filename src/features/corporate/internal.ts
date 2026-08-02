/** Shared internals for the corporate actions. NOT a "use server" module. */
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";
import type { SessionClaims } from "@/lib/auth/claims";

/**
 * `Corporate`/`TravelAgent`/`NegotiatedRate` are ORG-level master data (not in
 * PROPERTY_SCOPED_MODELS), so the scoped client passes them through unfiltered.
 * Reads/writes therefore constrain by `orgId` explicitly (never cross the org
 * boundary), while the transaction/audit/event plumbing is identical to the
 * property-scoped modules.
 */
export function corporateDb(user: SessionClaims) {
  return db.scoped(user);
}

export function withCorporateContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
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
