/** Shared internals for the housekeeping actions. NOT a "use server" module. */
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";
import type { SessionClaims } from "@/lib/auth/claims";

export function hkDb(user: SessionClaims) {
  return db.scoped(user);
}

export function withHkContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
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
