/** Shared internals for the dynamic-pricing actions/engine. NOT a "use server" module. */
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";
import type { SessionClaims } from "@/lib/auth/claims";

export function pricingDb(user: SessionClaims) {
  return db.scoped(user);
}

export function withPricingContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
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

/**
 * Normalise any Date to UTC midnight so it matches a `@db.Date` column exactly.
 * `DynamicRate.date` is date-only; comparing a Date that carries a time
 * component would miss the row.
 */
export function toUtcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
