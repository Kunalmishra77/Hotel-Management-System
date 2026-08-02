/**
 * Shared internals for 26-data-onboarding. NOT a "use server" module.
 *
 * ImportBatch/ImportRow are org-scoped with an OPTIONAL propertyId (a GUESTS
 * import is org-level, not property-level). The property-scoped client would
 * filter out a null-property batch, so — exactly as 04-guests does for its
 * org-scoped tables — we use `db.unscoped()` and constrain by `orgId` (and by
 * `propertyId` scope when the batch has one) in every query ourselves.
 */
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";
import { NotFoundError } from "@/lib/errors";
import type { SessionClaims } from "@/lib/auth/claims";

/** Above this row count, validate/commit are offloaded to a pg-boss job (NFR). */
export const IMPORT_INLINE_LIMIT = 2_000;
/** Commit processes rows in chunks so progress persists and memory stays bounded. */
export const COMMIT_CHUNK_SIZE = 200;

/** Org-scoped access to the import tables (see file header for why unscoped). */
export function importDb() {
  return db.unscoped();
}

export function withImportContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
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

/** Load a batch scoped to the caller's org, or 404 — never leak another org's batch. */
export async function loadBatch(orgId: string, batchId: string) {
  const batch = await importDb().importBatch.findFirst({
    where: { id: batchId, orgId },
  });
  if (!batch) throw new NotFoundError("Import batch not found.");
  return batch;
}

/** Split an array into fixed-size chunks (bounded-memory commit loop). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
