/**
 * The raw Prisma client singleton.
 *
 * DO NOT import `prisma` from feature or route code — eslint.config.mjs blocks
 * it. Operational reads/writes must go through `db.scoped(user)` or
 * `db.activeProperty(user)` (00 FR-8) so property tenancy cannot be bypassed by
 * forgetting a `where` clause. This module exists for lib-internal use, the
 * seed, and the vetted reporting escape hatch.
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Interactive-transaction budget.
 *
 * Prisma defaults to maxWait 2s / timeout 5s. The canonical write path
 * (validate → authorize → transaction → emitEvent → writeAudit) issues several
 * round trips inside one transaction, so on a managed database — or any link
 * with real latency — the 5s default aborts work that is progressing fine.
 *
 * These are CEILINGS, not targets: `non-functional-requirements.md` budgets
 * mutations at p95 < 800ms, and `business-rules.md` requires the booking path to
 * hold short transactions. A generous ceiling prevents spurious aborts without
 * licensing long lock holds — a transaction that genuinely needs 15s is a bug,
 * and it still gets killed.
 */
export const TRANSACTION_MAX_WAIT_MS = Number(process.env.DB_TX_MAX_WAIT_MS ?? 10_000);
export const TRANSACTION_TIMEOUT_MS = Number(process.env.DB_TX_TIMEOUT_MS ?? 15_000);

export function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    /**
     * Query logs are noisy and can contain PII values, so they stay off unless
     * `DB_LOG_QUERIES=true` asks for them.
     *
     * That switch exists because this application's latency is dominated by the
     * NUMBER of database round trips, not by query cost — the database sits in a
     * different region from the app server, so a query that executes in 0.1ms
     * still costs a round trip on the wire. "How many queries did this page
     * make?" is therefore the first question of any slowness investigation, and
     * without this flag there is no way to answer it. Count them with:
     *
     *   DB_LOG_QUERIES=true npm run dev     # then load the page and count
     *
     * Never enable it in production: the log would then carry query parameters,
     * which include guest PII (compliance.md).
     */
    log:
      process.env.DB_LOG_QUERIES === "true"
        ? ["query", "warn", "error"]
        : process.env.NODE_ENV === "development"
          ? ["warn", "error"]
          : ["error"],
    transactionOptions: {
      maxWait: TRANSACTION_MAX_WAIT_MS,
      timeout: TRANSACTION_TIMEOUT_MS,
    },
  });
}

function createClient(): PrismaClient {
  return createPrismaClient();
}

/**
 * Reused across hot reloads in dev — a new client per reload exhausts the
 * connection pool (and on a pooled managed host, the tenant's slot budget).
 */
export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
