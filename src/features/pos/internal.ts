/** Shared internals for the POS actions. NOT a "use server" module. */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";
import type { SessionClaims } from "@/lib/auth/claims";

/**
 * The charge type POS posts F&B lines to 06 with.
 *
 * SEE the report's INTEGRATION note: 06's `postFolioCharge` derives the GST rate
 * from the CHARGE TYPE, and its `POS` type is configured at 18% (misc goods),
 * whereas restaurant F&B is 5% (SAC 996331). Posting as `FOOD` yields the correct
 * 5% split, matches the fixtures' HSN 996331, matches 06's own walk-in path
 * (`settlePosSaleDirect` posts item type FOOD), and counts as F&B revenue in
 * reporting. This is the money-correct reading of FR-5's "FolioLine(type=POS)".
 */
export const POS_FOLIO_CHARGE_TYPE = "FOOD" as const;

export function posDb(user: SessionClaims) {
  return db.scoped(user);
}

export function withPosContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
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

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** Pad an order sequence to a stable, sortable, human code (e.g. POS-000123). */
export function formatOrderCode(seq: number): string {
  return `POS-${String(seq).padStart(6, "0")}`;
}

/**
 * Allocate the next GAP-FREE order code for a property, inside the caller's tx.
 *
 * There is no `PosOrderSeries` table, so the counter is derived under a
 * per-property Postgres advisory transaction lock (the same gap-free discipline
 * 06 uses for invoice numbering, business-rules.md §12): the lock serialises
 * allocation per property, then MAX(existing)+1 is the next number. The
 * `@@unique([propertyId, code])` constraint is the ultimate guard against a
 * duplicate slipping through.
 */
export async function allocateOrderCode(
  tx: Prisma.TransactionClient,
  propertyId: string,
): Promise<{ seq: number; code: string }> {
  // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void, which Prisma's
  // $queryRaw cannot deserialize. $executeRaw ignores the (void) result.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pos:${propertyId}`}))`;
  const rows = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT COALESCE(MAX(CAST(SUBSTRING("code" FROM '[0-9]+$') AS INTEGER)), 0) AS max
    FROM "PosOrder" WHERE "propertyId" = ${propertyId}
  `;
  const seq = (rows[0]?.max ?? 0) + 1;
  return { seq, code: formatOrderCode(seq) };
}

/** Lock a PosOrder row FOR UPDATE and read its status (concurrency gate, FR-18). */
export async function lockOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  propertyId: string,
): Promise<{ status: string; reservationId: string | null } | null> {
  const rows = await tx.$queryRaw<{ status: string; reservationId: string | null }[]>`
    SELECT "status", "reservationId" FROM "PosOrder"
    WHERE "id" = ${orderId} AND "propertyId" = ${propertyId} FOR UPDATE
  `;
  return rows[0] ?? null;
}
