/**
 * Accounting-sync queries — 22 T-9 (FR-6, AC-7). The reconciliation view: which
 * documents are synced / sandbox / pending / failed per provider, the last sync
 * time, the failed queue (for retry) and a recent activity list.
 *
 * `AccountingConfig` / `AccountingSyncLog` are org-level (not property-scoped)
 * tables, so this reads through db.unscoped() and guards the read itself with
 * `integration:manage` — org-global data must not be returned to a role that
 * cannot manage integrations (AC-12), independent of the page guard.
 */
import { authorize } from "@/lib/permissions";
import { accountingDb, SyncStatus } from "./internal";
import type { SessionClaims } from "@/lib/auth/claims";

export type ProviderSummary = {
  provider: string;
  mode: string | null;
  total: number;
  synced: number;
  sandbox: number;
  pending: number;
  failed: number;
  lastSyncAt: Date | null;
};

export type ReconciliationRow = {
  id: string;
  provider: string;
  entityType: string;
  entityId: string;
  status: string;
  externalId: string | null;
  error: string | null;
  createdAt: Date;
};

export type Reconciliation = {
  providers: ProviderSummary[];
  failed: ReconciliationRow[];
  recent: ReconciliationRow[];
};

function mapRow(r: {
  id: string;
  provider: string;
  entityType: string;
  entityId: string;
  status: string;
  externalId: string | null;
  error: string | null;
  createdAt: Date;
}): ReconciliationRow {
  return {
    id: r.id,
    provider: r.provider,
    entityType: r.entityType,
    entityId: r.entityId,
    status: r.status,
    externalId: r.externalId,
    error: r.error,
    createdAt: r.createdAt,
  };
}

export async function reconciliation(user: SessionClaims): Promise<Reconciliation> {
  authorize(user, "integration:manage", null); // org-global read (AC-7/AC-12)
  const prisma = accountingDb();

  const [configs, grouped, lastByProvider, failed, recent] = await Promise.all([
    prisma.accountingConfig.findMany({
      where: { orgId: user.orgId },
      select: { provider: true, mode: true },
    }),
    prisma.accountingSyncLog.groupBy({ by: ["provider", "status"], _count: { _all: true } }),
    prisma.accountingSyncLog.groupBy({
      by: ["provider"],
      where: { status: { in: [SyncStatus.SYNCED, SyncStatus.SANDBOX] } },
      _max: { createdAt: true },
    }),
    prisma.accountingSyncLog.findMany({
      where: { status: SyncStatus.FAILED },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.accountingSyncLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  const modeByProvider = new Map(configs.map((c) => [c.provider, c.mode]));
  const lastByProviderMap = new Map(lastByProvider.map((g) => [g.provider, g._max.createdAt]));

  const providerNames = new Set<string>([
    ...configs.map((c) => c.provider),
    ...grouped.map((g) => g.provider),
  ]);

  const countFor = (provider: string, status: string): number =>
    grouped.find((g) => g.provider === provider && g.status === status)?._count._all ?? 0;

  const providers: ProviderSummary[] = [...providerNames].sort().map((provider) => {
    const synced = countFor(provider, SyncStatus.SYNCED);
    const sandbox = countFor(provider, SyncStatus.SANDBOX);
    const pending = countFor(provider, SyncStatus.PENDING);
    const failed = countFor(provider, SyncStatus.FAILED);
    return {
      provider,
      mode: modeByProvider.get(provider) ?? null,
      total: synced + sandbox + pending + failed,
      synced,
      sandbox,
      pending,
      failed,
      lastSyncAt: lastByProviderMap.get(provider) ?? null,
    };
  });

  return { providers, failed: failed.map(mapRow), recent: recent.map(mapRow) };
}
