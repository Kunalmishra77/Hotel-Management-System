/**
 * Shared internals for the integrations console (16/12/22/13). NOT a
 * "use server" module.
 *
 * db.unscoped() is used deliberately (data-model.md escape hatch): integration
 * config is org-level platform infrastructure with no property scope —
 * `MessagingAccount`/`AccountingConfig` are keyed by orgId, `ChannelAccount` is
 * read only to count live vs sandbox connections across the org. Every caller is
 * still gated by `authorize(integration:manage)` (Administrator-only) and
 * constrained to the caller's own orgId.
 */
import type { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";
import type { SessionClaims } from "@/lib/auth/claims";

/** The raw (unscoped) client — integration config is org-level platform infra. */
export function integrationsDb(): PrismaClient {
  return db.unscoped();
}

/** Run `fn` with a bound context so the config action's audit row has an actor. */
export function withIntegrationsContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
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
