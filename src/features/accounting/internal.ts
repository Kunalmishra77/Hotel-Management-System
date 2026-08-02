/**
 * Shared internals for the accounting-sync module. NOT a "use server" module.
 *
 * Holds: the sync-log status constants (reconciliation reads these), the
 * per-request context wrapper for the config action, config resolution, and the
 * entity loaders that turn a (entityType, entityId) key into the normalized
 * record `toAccountingDoc` maps.
 *
 * db.unscoped() is used deliberately (data-model.md escape hatch): accounting
 * sync is org-level platform infrastructure that consumes cross-property finance
 * events off the request path — it has no SessionClaims property scope. It only
 * READS 06/07/21-owned rows (never writes them) and owns just AccountingConfig /
 * AccountingSyncLog, neither of which is a property-scoped model.
 */
import type { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";
import type { SessionClaims } from "@/lib/auth/claims";
import type { AccountingGlMappings } from "@/lib/accounting";
import type {
  AccountingEntityRecord,
  AccountingEntityType,
} from "./domain/to-accounting-doc";

/** `AccountingSyncLog.status` values (schema stores a free String; this is the set). */
export const SyncStatus = {
  PENDING: "PENDING",
  SANDBOX: "SANDBOX",
  SYNCED: "SYNCED",
  FAILED: "FAILED",
} as const;
export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus];

/** A settled log is terminal-success — a re-run must not touch it (idempotency). */
export function isTerminalSuccess(status: string): boolean {
  return status === SyncStatus.SYNCED || status === SyncStatus.SANDBOX;
}

/** With no `AccountingConfig` the system still runs sandbox with zero accounts. */
export const DEFAULT_ACCOUNTING_PROVIDER = process.env.ACCOUNTING_PROVIDER ?? "mock";
export const DEFAULT_ACCOUNTING_MODE = "sandbox";

export type ResolvedConfig = {
  provider: string;
  mode: string;
  glMappings: AccountingGlMappings | null;
};

/** Run `fn` with a bound context so the config action's audit row has an actor. */
export function withAccountingContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
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

/** Every configured provider for an org (or the sandbox default when none). */
export async function loadAccountingConfigs(
  prisma: PrismaClient,
  orgId: string,
): Promise<ResolvedConfig[]> {
  const rows = await prisma.accountingConfig.findMany({ where: { orgId } });
  if (rows.length === 0) {
    return [{ provider: DEFAULT_ACCOUNTING_PROVIDER, mode: DEFAULT_ACCOUNTING_MODE, glMappings: null }];
  }
  return rows.map((r) => ({
    provider: r.provider,
    mode: r.mode,
    glMappings: (r.glMappings ?? null) as AccountingGlMappings | null,
  }));
}

/** Resolve the config for one provider (or a sandbox default if not configured). */
export async function configFor(
  prisma: PrismaClient,
  orgId: string,
  provider: string,
): Promise<ResolvedConfig> {
  const row = await prisma.accountingConfig.findFirst({ where: { orgId, provider } });
  if (!row) return { provider, mode: DEFAULT_ACCOUNTING_MODE, glMappings: null };
  return {
    provider: row.provider,
    mode: row.mode,
    glMappings: (row.glMappings ?? null) as AccountingGlMappings | null,
  };
}

function isoDate(d: Date | null | undefined): string {
  return (d ?? new Date()).toISOString().slice(0, 10);
}

function toNum(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value;
}

/**
 * Turn a (entityType, entityId) key into the normalized record the mapper needs.
 * Reload-based so the same routine serves the consumer, the worker sweep and the
 * admin retry. Returns null when the entity cannot be found (skip, not fail).
 */
export async function loadEntityRecord(
  prisma: PrismaClient,
  entityType: AccountingEntityType,
  entityId: string,
): Promise<AccountingEntityRecord | null> {
  switch (entityType) {
    case "Invoice": {
      const inv = await prisma.invoice.findFirst({ where: { id: entityId } });
      if (!inv) return null;
      return {
        entityType: "Invoice",
        id: inv.id,
        number: inv.number,
        invoiceType: inv.type,
        propertyId: inv.propertyId,
        customerName: inv.customerName,
        customerGstin: inv.customerGstin,
        taxableValuePaise: toNum(inv.taxableValuePaise),
        cgstPaise: inv.cgstPaise,
        sgstPaise: inv.sgstPaise,
        igstPaise: inv.igstPaise,
        totalPaise: toNum(inv.totalPaise),
        dateISO: isoDate(inv.issuedAt),
        cancelsInvoiceId: inv.cancelsInvoiceId,
      };
    }
    case "Expense": {
      const exp = await prisma.expense.findFirst({ where: { id: entityId } });
      if (!exp) return null;
      return {
        entityType: "Expense",
        id: exp.id,
        propertyId: exp.propertyId,
        head: exp.head,
        subCategory: exp.subCategory,
        amountPaise: exp.amountPaise,
        vendor: exp.vendor,
        dateISO: isoDate(exp.spentOn),
      };
    }
    case "Payroll": {
      const run = await prisma.payrollRun.findFirst({ where: { id: entityId } });
      if (!run) return null;
      return {
        entityType: "Payroll",
        id: run.id,
        propertyId: run.propertyId,
        month: run.month,
        netTotalPaise: toNum(run.netTotalPaise),
        dateISO: isoDate(run.finalizedAt ?? run.createdAt),
      };
    }
    case "Payment":
      return loadPaymentRecord(prisma, entityId);
  }
}

/**
 * Payments key on the settlement batch (a received document groups split
 * tenders), the payment id (a refund), or — when neither is available — the
 * originating DomainEvent id. The three-way lookup keeps every payment document
 * reloadable from just its key. (See consumer.ts for how the key is chosen.)
 */
async function loadPaymentRecord(
  prisma: PrismaClient,
  entityId: string,
): Promise<AccountingEntityRecord | null> {
  const single = await prisma.payment.findFirst({ where: { id: entityId } });
  if (single) {
    return {
      entityType: "Payment",
      id: entityId,
      propertyId: single.propertyId,
      amountPaise: toNum(single.amountPaise),
      mode: single.mode,
      isRefund: single.isRefund,
      folioId: single.folioId,
      reference: single.reference,
      dateISO: isoDate(single.receivedAt),
    };
  }

  const batch = await prisma.payment.findMany({ where: { settlementBatchId: entityId } });
  if (batch.length > 0) {
    const received = batch.filter((p) => !p.isRefund);
    const rows = received.length > 0 ? received : batch;
    const amountPaise = rows.reduce((sum, p) => sum + toNum(p.amountPaise), 0);
    const first = rows[0]!;
    return {
      entityType: "Payment",
      id: entityId,
      propertyId: first.propertyId,
      amountPaise,
      mode: rows.length > 1 ? "SPLIT" : first.mode,
      isRefund: false,
      folioId: first.folioId,
      reference: null,
      dateISO: isoDate(first.receivedAt),
    };
  }

  // Fallback: rebuild from the durable outbox event (payload has the amounts).
  const ev = await prisma.domainEvent.findUnique({ where: { id: entityId } });
  if (!ev) return null;
  const payload = (ev.payload ?? {}) as Record<string, unknown>;
  const isRefund = ev.type === "PaymentRefunded";
  const tenders = Array.isArray(payload.tenders)
    ? (payload.tenders as Array<{ amountPaise?: number; mode?: string }>)
    : [];
  const amountPaise = isRefund
    ? Number(payload.amountPaise ?? 0)
    : tenders.reduce((sum, t) => sum + Number(t.amountPaise ?? 0), 0);
  return {
    entityType: "Payment",
    id: entityId,
    propertyId: ev.propertyId,
    amountPaise,
    mode: isRefund ? "REFUND" : tenders.length > 1 ? "SPLIT" : (tenders[0]?.mode ?? "UNKNOWN"),
    isRefund,
    folioId: typeof payload.folioId === "string" ? payload.folioId : ev.aggregateId,
    reference: null,
    dateISO: isoDate(ev.occurredAt),
  };
}

/** Resolve the org that owns a sync-log row (single-org system; entity fallback). */
export async function orgIdForRow(
  prisma: PrismaClient,
  entityType: AccountingEntityType,
  entityId: string,
): Promise<string | null> {
  const anyCfg = await prisma.accountingConfig.findFirst({ select: { orgId: true } });
  if (anyCfg) return anyCfg.orgId;
  // Zero-config fallback: derive from the entity's property.
  const record = await loadEntityRecord(prisma, entityType, entityId);
  const propertyId = record && "propertyId" in record ? record.propertyId : null;
  if (!propertyId) return null;
  const prop = await prisma.property.findFirst({ where: { id: propertyId }, select: { orgId: true } });
  return prop?.orgId ?? null;
}

/** The raw (unscoped) client — accounting sync is org-level platform infra. */
export function accountingDb(): PrismaClient {
  return db.unscoped();
}
