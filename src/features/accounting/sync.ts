/**
 * The accounting sync engine — 22 T-6/T-7 (FR-3/4/5, AC-1..4/10).
 *
 * Split by responsibility:
 *   enqueueSync  — the consumer's "enqueue": one PENDING AccountingSyncLog per
 *                  configured provider, idempotent on the unique key. No external
 *                  call, so the front desk / finance path is never blocked (FR-5).
 *   syncOne      — the idempotent push for ONE (provider, entity): resolve the
 *                  adapter, build the doc, push (sandbox = mock, no network),
 *                  record the outcome + event + audit, alert on a NEW failure.
 *   syncWorker   — the pg-boss sweep: drain PENDING and re-attempt FAILED rows
 *                  (self-heals once the admin fixes credentials — AC-10).
 *   resyncLog    — retry one row on demand (the admin "retry" button — AC-10).
 *
 * Idempotency (FR-3): the unique (provider, entityType, entityId) plus the
 * terminal-success short-circuit mean a re-delivered event or a re-run never
 * creates a duplicate in the accounting system — the stored externalId is kept.
 */
import type { PrismaClient } from "@prisma/client";
import { emitEvent } from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import { alertAdmin } from "@/lib/alerts";
import { logger } from "@/lib/logger";
import { runWithSystemContext } from "@/lib/context";
import { resolveAccountingProvider, type AccountingDoc, type AccountingProvider } from "@/lib/accounting";
import { toAccountingDoc, syncKey, type AccountingEntityType } from "./domain/to-accounting-doc";
import {
  SyncStatus,
  configFor,
  isTerminalSuccess,
  loadAccountingConfigs,
  loadEntityRecord,
  orgIdForRow,
  type ResolvedConfig,
} from "./internal";

export type SyncOutcome =
  | { ok: true; status: "SANDBOX" | "SYNCED" | "ALREADY_SYNCED"; externalId: string | null }
  | { ok: false; status: "FAILED" | "SKIPPED"; error: string };

function pushByKind(provider: AccountingProvider, doc: AccountingDoc) {
  switch (doc.kind) {
    case "INVOICE":
    case "CREDIT_NOTE":
      return provider.pushInvoice(doc);
    case "EXPENSE":
    case "PAYROLL_JOURNAL":
      return provider.pushExpense(doc);
    case "PAYMENT":
    case "REFUND":
      return provider.pushPayment(doc);
  }
}

/** Enqueue a PENDING sync row per configured provider (idempotent). FR-2. */
export async function enqueueSync(
  prisma: PrismaClient,
  orgId: string,
  entityType: AccountingEntityType,
  entityId: string,
): Promise<{ enqueued: number }> {
  const configs = await loadAccountingConfigs(prisma, orgId);
  let enqueued = 0;
  for (const cfg of configs) {
    await prisma.accountingSyncLog.upsert({
      where: { provider_entityType_entityId: { provider: cfg.provider, entityType, entityId } },
      // Create-only: an existing row (PENDING/SANDBOX/SYNCED/FAILED) is left
      // untouched, so a re-delivered event never resets a settled sync.
      create: { provider: cfg.provider, entityType, entityId, status: SyncStatus.PENDING },
      update: {},
      select: { id: true },
    });
    enqueued += 1;
  }
  return { enqueued };
}

/** Push ONE (provider, entity), recording the terminal outcome. FR-3/4. */
export async function syncOne(
  prisma: PrismaClient,
  orgId: string,
  cfg: ResolvedConfig,
  entityType: AccountingEntityType,
  entityId: string,
): Promise<SyncOutcome> {
  const provider = cfg.provider;
  const existing = await prisma.accountingSyncLog.findUnique({
    where: { provider_entityType_entityId: { provider, entityType, entityId } },
  });

  // Idempotent short-circuit: a settled sync is never pushed again (AC-3/10).
  if (existing && isTerminalSuccess(existing.status) && existing.externalId) {
    return { ok: true, status: "ALREADY_SYNCED", externalId: existing.externalId };
  }

  const record = await loadEntityRecord(prisma, entityType, entityId);
  if (!record) {
    logger.warn("accounting.entity_missing", { provider, entityType, entityId });
    return { ok: false, status: "SKIPPED", error: "entity not found" };
  }

  const doc = toAccountingDoc(record, provider, cfg.glMappings);
  const adapter = resolveAccountingProvider({ provider, mode: cfg.mode });
  const res = await pushByKind(adapter, doc); // sandbox adapter = mock, no network (FR-4)

  const status = res.ok
    ? adapter.isLive
      ? SyncStatus.SYNCED
      : SyncStatus.SANDBOX
    : SyncStatus.FAILED;
  const externalId = res.ok ? res.externalId : null;
  const error = res.ok ? null : res.error;
  const wasFailed = existing?.status === SyncStatus.FAILED;

  await prisma.$transaction(async (tx) => {
    await tx.accountingSyncLog.upsert({
      where: { provider_entityType_entityId: { provider, entityType, entityId } },
      create: { provider, entityType, entityId, status, externalId, error },
      update: { status, externalId, error },
    });

    const key = syncKey(provider, entityType, entityId);
    if (status === SyncStatus.FAILED) {
      // Emit/alert once per NEW failure so a minute-by-minute retry sweep of a
      // still-broken row does not spam (FR-5, AC-4).
      if (!wasFailed) {
        await emitEvent(tx, {
          type: "AccountingSyncFailed",
          aggregateId: entityId,
          propertyId: doc.propertyId,
          orgId,
          payload: { provider, entityType, entityId, error },
        });
        await writeAudit(tx, {
          action: "accounting:sync-failed",
          entityType: "AccountingSyncLog",
          entityId: key,
          propertyId: doc.propertyId,
          orgId,
          after: { provider, status, error },
        });
      }
    } else {
      await emitEvent(tx, {
        type: "AccountingSynced",
        aggregateId: entityId,
        propertyId: doc.propertyId,
        orgId,
        payload: { provider, entityType, entityId, externalId, sandbox: status === SyncStatus.SANDBOX },
      });
      await writeAudit(tx, {
        action: "accounting:synced",
        entityType: "AccountingSyncLog",
        entityId: key,
        propertyId: doc.propertyId,
        orgId,
        after: { provider, status, externalId },
      });
    }
  });

  if (status === SyncStatus.FAILED) {
    if (!wasFailed) {
      // Dead-letter surface: the FAILED row stays in reconciliation + is retriable.
      await alertAdmin({
        severity: "warning",
        code: "accounting.sync_failed",
        title: `Accounting sync failed (${provider} · ${entityType})`,
        detail: { provider, entityType, entityId, error },
      });
    }
    return { ok: false, status: "FAILED", error: error ?? "push failed" };
  }
  return {
    ok: true,
    status: status === SyncStatus.SANDBOX ? "SANDBOX" : "SYNCED",
    externalId,
  };
}

/** Push an entity to every configured provider (retry action / direct use). */
export async function pushDocument(
  prisma: PrismaClient,
  input: { orgId: string; entityType: AccountingEntityType; entityId: string },
): Promise<SyncOutcome> {
  const configs = await loadAccountingConfigs(prisma, input.orgId);
  let firstFailure: SyncOutcome | null = null;
  let anyOk: SyncOutcome | null = null;
  for (const cfg of configs) {
    const outcome = await syncOne(prisma, input.orgId, cfg, input.entityType, input.entityId);
    if (outcome.ok) anyOk = anyOk ?? outcome;
    else if (outcome.status === "FAILED" && !firstFailure) firstFailure = outcome;
  }
  return firstFailure ?? anyOk ?? { ok: false, status: "SKIPPED", error: "nothing synced" };
}

/**
 * The pg-boss sweep: drain PENDING rows and re-attempt FAILED ones. Runs in the
 * worker, off the request path. Retry cadence is the schedule interval; genuine
 * infra transients are also retried by pg-boss's job backoff.
 */
export async function syncWorker(
  prisma: PrismaClient,
  opts: { providers?: string[]; retryFailed?: boolean; take?: number } = {},
): Promise<{ processed: number; synced: number; sandbox: number; failed: number; skipped: number }> {
  const statuses = opts.retryFailed === false ? [SyncStatus.PENDING] : [SyncStatus.PENDING, SyncStatus.FAILED];
  const rows = await prisma.accountingSyncLog.findMany({
    where: {
      status: { in: statuses },
      ...(opts.providers ? { provider: { in: opts.providers } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: opts.take ?? 200,
  });

  const result = { processed: 0, synced: 0, sandbox: 0, failed: 0, skipped: 0 };
  for (const row of rows) {
    const entityType = row.entityType as AccountingEntityType;
    const orgId = await orgIdForRow(prisma, entityType, row.entityId);
    if (!orgId) {
      result.skipped += 1;
      continue;
    }
    const cfg = await configFor(prisma, orgId, row.provider);
    const outcome = await runWithSystemContext(orgId, () =>
      syncOne(prisma, orgId, cfg, entityType, row.entityId),
    );
    result.processed += 1;
    if (outcome.ok) {
      if (outcome.status === "SYNCED") result.synced += 1;
      else if (outcome.status === "SANDBOX") result.sandbox += 1;
    } else if (outcome.status === "FAILED") result.failed += 1;
    else result.skipped += 1;
  }
  if (result.processed > 0) logger.info("accounting.sync_worker", { ...result });
  return result;
}

/** Retry one sync-log row on demand (admin action). Idempotent. AC-10. */
export async function resyncLog(prisma: PrismaClient, orgId: string, logId: string): Promise<SyncOutcome> {
  const row = await prisma.accountingSyncLog.findUnique({ where: { id: logId } });
  if (!row) return { ok: false, status: "SKIPPED", error: "sync record not found" };
  const cfg = await configFor(prisma, orgId, row.provider);
  return syncOne(prisma, orgId, cfg, row.entityType as AccountingEntityType, row.entityId);
}
