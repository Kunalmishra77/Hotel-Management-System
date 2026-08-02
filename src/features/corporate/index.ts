/**
 * Corporate — public surface (Tier-1 master-data services + module barrel).
 *
 * 25-corporate-crm owns the corporate relationship, negotiated rates and credit.
 * When a folio settles on CORPORATE_CREDIT, 06-billing (Tier 2) must reserve
 * credit against the corporate's limit atomically (design.md § Corporate
 * settlement). Rather than have 06 write `Corporate` directly (a boundary
 * breach), this surface exposes the credit services; 06 calls DOWN into them
 * inside its own settlement transaction. Same pattern + rationale as ADR 0006.
 *
 * `reserveCredit` MUST keep its exact signature + behaviour — 06 (signed off)
 * depends on it. `releaseCredit` is the payment/void counterpart added by 25.
 */
import type { Prisma } from "@prisma/client";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { exceedsLimit } from "./domain/available-credit";

/**
 * Atomically check-and-increment a corporate's receivable against its limit,
 * UNDER A ROW LOCK (`SELECT … FOR UPDATE`), inside the caller's transaction. Two
 * concurrent near-limit settlements serialize — only the amount that fits is
 * admitted; the other rolls back (`CREDIT_LIMIT_EXCEEDED`). No check-then-act.
 */
export async function reserveCredit(
  tx: Prisma.TransactionClient,
  corporateId: string,
  amountPaise: bigint,
): Promise<{ receivablePaise: bigint }> {
  const rows = await tx.$queryRaw<{ creditLimitPaise: bigint; receivablePaise: bigint }[]>`
    SELECT "creditLimitPaise", "receivablePaise" FROM "Corporate" WHERE "id" = ${corporateId} FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw new NotFoundError("Corporate account not found.");

  const limit = BigInt(row.creditLimitPaise);
  const current = BigInt(row.receivablePaise);
  // The pure predicate (domain/available-credit) is the single definition of
  // "over limit" — the same one every statement/gauge reads.
  if (exceedsLimit(limit, current, amountPaise)) {
    throw new DomainError(ErrorCode.CREDIT_LIMIT_EXCEEDED);
  }
  const next = current + amountPaise;
  await tx.corporate.update({ where: { id: corporateId }, data: { receivablePaise: next } });
  return { receivablePaise: next };
}

/**
 * Atomically decrement a corporate's receivable — the payment/void counterpart
 * of `reserveCredit` (AC-10). Runs under the SAME `SELECT … FOR UPDATE` row lock
 * so a concurrent settlement and a release can never interleave into a lost
 * update. The receivable is floored at zero: a release can never drive an account
 * negative (a double-release is clamped rather than creating phantom credit).
 * 06 owns the receivable write; it calls this inside its payment/void transaction.
 */
export async function releaseCredit(
  tx: Prisma.TransactionClient,
  corporateId: string,
  amountPaise: bigint,
): Promise<{ receivablePaise: bigint }> {
  const rows = await tx.$queryRaw<{ receivablePaise: bigint }[]>`
    SELECT "receivablePaise" FROM "Corporate" WHERE "id" = ${corporateId} FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw new NotFoundError("Corporate account not found.");

  const current = BigInt(row.receivablePaise);
  const reduced = current - (amountPaise > 0n ? amountPaise : 0n);
  const next = reduced > 0n ? reduced : 0n;
  await tx.corporate.update({ where: { id: corporateId }, data: { receivablePaise: next } });
  return { receivablePaise: next };
}

// Read surface used by 03/23 (rate resolution) and reporting — re-exported so
// callers import from `@/features/corporate` (never a deep internal path).
export { getNegotiatedRate } from "./queries";
export type {
  CorporateStatement,
  StatementCharge,
  AttributionReport,
  AttributionRow,
  AgentCommissionRow,
  CorporateListItem,
  AgentListItem,
} from "./queries";
export { availableCredit, exceedsLimit } from "./domain/available-credit";
