/** Shared internals for analytics. NOT a "use server" module. */
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";
import type { SessionClaims } from "@/lib/auth/claims";

export function analyticsDb(user: SessionClaims) {
  return db.scoped(user);
}

export function withAnalyticsContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
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

/** Epoch-day of a `@db.Date` value (UTC calendar). */
export function utcEpochDay(d: Date): number {
  return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000);
}

/** The [start, next) UTC-midnight bounds of a business date. */
export function dayBounds(date: Date): { start: Date; next: Date } {
  const day = utcEpochDay(date);
  return { start: new Date(day * 86_400_000), next: new Date((day + 1) * 86_400_000) };
}
