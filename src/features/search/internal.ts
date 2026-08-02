/**
 * 15 internals. Search/export own no tables; ExportJob is org/user-scoped (no
 * propertyId), so its writes + the DataExported event + audit run on the
 * UNSCOPED client inside a request context (for emitEvent/writeAudit orgId).
 */
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";
import type { SessionClaims } from "@/lib/auth/claims";

export function searchDb() {
  return db.unscoped();
}

export function withSearchContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
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
