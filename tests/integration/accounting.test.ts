/**
 * 22 accounting-sync integration — T-5..T-9. The crux guarantees:
 *  - the 5 settled-finance consumers ENQUEUE a sync; raw FolioCharged is NOT
 *    consumed (no double entries — AC-11);
 *  - syncWorker performs an idempotent SANDBOX push (mock, no external call) and
 *    stores an externalId (AC-1);
 *  - a re-delivered event / re-run creates NO duplicate (unique key — AC-3);
 *  - expense + payroll + payment + refund all sync (AC-5/6);
 *  - a live-not-wired push FAILS + alerts, then an admin retry after "fixing"
 *    the config clears it idempotently (AC-4/10);
 *  - configureAccounting + reconciliation are RBAC-gated (AC-8/12) and the
 *    reconciliation view reports per-provider status (AC-7).
 *
 * Auth mocked at the boundary (as in reports/channels tests). Everything else is
 * real against the test DB. Own rows use per-run-unique ids/providers; cleaned in
 * afterAll (AccountingSyncLog + Config are deletable).
 */
import { vi } from "vitest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";
import type { EventEnvelope } from "@/lib/events/dispatch";

const authMock = vi.hoisted(() => ({ current: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => {
    if (!authMock.current) throw new Error("no test user set");
    return authMock.current;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { ORG_ID, PROP_A_ID, USER_ADMIN_ID, USER_MANAGER_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { setAlertTransport, resetAlertTransport, type Alert } from "@/lib/alerts";
import { SyncStatus } from "@/features/accounting/internal";
import { enqueueSync, syncWorker, syncOne } from "@/features/accounting/sync";
import { accountingConsumer, entityRefForEvent } from "@/features/accounting/consumer";
import { configureAccounting, retrySync } from "@/features/accounting/actions";
import { reconciliation } from "@/features/accounting/queries";

const prisma = createPrismaClient();

// Per-run-unique so re-runs never collide on the unique (provider,type,entityId)
// or (orgId,provider) constraints, and other suites' rows are never touched.
const SLOT = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const PROVIDER = `zoho_t22_${SLOT}`; // sandbox config
const PROVIDER_LIVE = `live_t22_${SLOT}`; // live-not-wired (direct syncOne only)

let folioId = "";
const invId = `t22_inv_${SLOT}`;
const expId = `t22_exp_${SLOT}`;
const runId = `t22_run_${SLOT}`;
const batchId = `t22_batch_${SLOT}`;
let refundId = "";
const alerts: Alert[] = [];

async function actAs(userId: string): Promise<SessionClaims> {
  const claims = await assembleClaims(prisma, userId);
  if (!claims) throw new Error(`no claims for ${userId}`);
  authMock.current = claims;
  return claims;
}

function envelope(type: string, aggregateId: string, payload: Record<string, unknown> = {}): EventEnvelope {
  return {
    id: `evt_${SLOT}_${type}_${aggregateId}`,
    seq: 1n,
    type,
    orgId: ORG_ID,
    propertyId: PROP_A_ID,
    aggregateId,
    payload,
    occurredAt: new Date(),
  };
}

function logFor(provider: string, entityType: string, entityId: string) {
  return prisma.accountingSyncLog.findUnique({
    where: { provider_entityType_entityId: { provider, entityType, entityId } },
  });
}

beforeAll(async () => {
  setAlertTransport({ name: "test", async send(a) { alerts.push(a); } });

  // My sandbox config (mock adapter → SANDBOX, zero external accounts).
  await prisma.accountingConfig.upsert({
    where: { orgId_provider: { orgId: ORG_ID, provider: PROVIDER } },
    create: { orgId: ORG_ID, provider: PROVIDER, mode: "sandbox" },
    update: { mode: "sandbox" },
  });

  const folio = await prisma.folio.create({ data: { propertyId: PROP_A_ID, kind: "DIRECT_SALE" }, select: { id: true } });
  folioId = folio.id;

  await prisma.invoice.create({
    data: {
      id: invId, propertyId: PROP_A_ID, folioId, number: `T22/${SLOT}/1`, financialYear: "2026-27",
      type: "TAX_INVOICE", customerName: "Ravi", placeOfSupply: "29-Karnataka",
      taxableValuePaise: 1_200_000n, cgstPaise: 108_000, sgstPaise: 108_000, totalPaise: 1_341_000n,
    },
  });
  await prisma.expense.create({ data: { id: expId, propertyId: PROP_A_ID, head: "KITCHEN", amountPaise: 120_000, spentOn: new Date("2026-07-02"), status: "APPROVED" } });
  await prisma.payrollRun.create({ data: { id: runId, propertyId: PROP_A_ID, month: `t22m${SLOT}`, netTotalPaise: 5_048_100n, status: "FINALIZED", finalizedAt: new Date() } });
  await prisma.payment.create({ data: { propertyId: PROP_A_ID, folioId, mode: "UPI", amountPaise: 500_000n, settlementBatchId: batchId, isRefund: false } });
  const refund = await prisma.payment.create({ data: { propertyId: PROP_A_ID, folioId, mode: "UPI", amountPaise: 100_000n, isRefund: true }, select: { id: true } });
  refundId = refund.id;
});

beforeEach(() => {
  authMock.current = null;
  alerts.length = 0;
});

afterAll(async () => {
  await prisma.accountingSyncLog.deleteMany({ where: { entityId: { in: [invId, expId, runId, batchId, refundId] } } });
  await prisma.accountingSyncLog.deleteMany({ where: { provider: { in: [PROVIDER, PROVIDER_LIVE] } } });
  await prisma.accountingConfig.deleteMany({ where: { orgId: ORG_ID, provider: { in: [PROVIDER, PROVIDER_LIVE, "tally"] } } });
  // Payment/Invoice are append-only and Folio is FK-restricted by them — they
  // persist (ids are per-run-unique via SLOT, so no re-run collision). Only the
  // deletable rows are cleaned.
  await prisma.expense.deleteMany({ where: { id: expId } });
  await prisma.payrollRun.deleteMany({ where: { id: runId } });
  resetAlertTransport();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe("consumers enqueue; NO FolioCharged (T-5, FR-2, AC-5/6/11)", () => {
  it("does NOT consume raw FolioCharged — no double entries (AC-11)", async () => {
    // The consumer's declared types must exclude FolioCharged and include the 5.
    expect(accountingConsumer.types).not.toContain("FolioCharged");
    for (const t of ["InvoiceIssued", "PaymentReceived", "PaymentRefunded", "ExpenseRecorded", "PayrollFinalized"]) {
      expect(accountingConsumer.types).toContain(t);
    }
    // Routing a FolioCharged yields no sync ref and enqueues nothing.
    expect(entityRefForEvent(envelope("FolioCharged", folioId))).toBeNull();
    await accountingConsumer.handle(envelope("FolioCharged", folioId));
    expect(await logFor(PROVIDER, "Invoice", folioId)).toBeNull();
    expect(await logFor(PROVIDER, "Payment", folioId)).toBeNull();
  });

  it("InvoiceIssued enqueues a PENDING row; syncWorker records SANDBOX + externalId, no external call (AC-1)", async () => {
    await accountingConsumer.handle(envelope("InvoiceIssued", invId));
    const enqueued = await logFor(PROVIDER, "Invoice", invId);
    expect(enqueued?.status).toBe(SyncStatus.PENDING);

    const worked = await syncWorker(prisma, { providers: [PROVIDER] });
    expect(worked.sandbox).toBeGreaterThanOrEqual(1);
    const synced = await logFor(PROVIDER, "Invoice", invId);
    expect(synced?.status).toBe(SyncStatus.SANDBOX);
    expect(synced?.externalId?.startsWith("mock-")).toBe(true);
  });

  it("ExpenseRecorded + PayrollFinalized + Payment + Refund all sync (AC-5/6)", async () => {
    await accountingConsumer.handle(envelope("ExpenseRecorded", expId));
    await accountingConsumer.handle(envelope("PayrollFinalized", runId));
    await accountingConsumer.handle(envelope("PaymentReceived", folioId, { folioId, settlementBatchId: batchId, tenders: [{ mode: "UPI", amountPaise: 500_000 }] }));
    await accountingConsumer.handle(envelope("PaymentRefunded", folioId, { paymentId: refundId, amountPaise: 100_000 }));

    await syncWorker(prisma, { providers: [PROVIDER] });

    expect((await logFor(PROVIDER, "Expense", expId))?.status).toBe(SyncStatus.SANDBOX);
    expect((await logFor(PROVIDER, "Payroll", runId))?.status).toBe(SyncStatus.SANDBOX);
    expect((await logFor(PROVIDER, "Payment", batchId))?.status).toBe(SyncStatus.SANDBOX);
    expect((await logFor(PROVIDER, "Payment", refundId))?.status).toBe(SyncStatus.SANDBOX);
  });
});

describe("idempotency (T-6, FR-3, AC-3)", () => {
  it("a re-delivered event and a re-run create NO duplicate; externalId is kept", async () => {
    await accountingConsumer.handle(envelope("InvoiceIssued", invId)); // enqueue (row may already be SANDBOX)
    await syncWorker(prisma, { providers: [PROVIDER] });
    const first = await logFor(PROVIDER, "Invoice", invId);
    expect(first?.status).toBe(SyncStatus.SANDBOX);

    // Re-deliver the same event + re-run the worker.
    await accountingConsumer.handle(envelope("InvoiceIssued", invId));
    await syncWorker(prisma, { providers: [PROVIDER] });

    const rows = await prisma.accountingSyncLog.findMany({ where: { provider: PROVIDER, entityType: "Invoice", entityId: invId } });
    expect(rows).toHaveLength(1); // unique (provider, entityType, entityId)
    expect(rows[0]!.externalId).toBe(first?.externalId); // unchanged — no re-push
  });
});

describe("failure → dead-letter + alert, then idempotent retry (T-7, FR-5, AC-4/10)", () => {
  it("a live-not-wired push FAILS + alerts once; a fixed retry clears it, idempotently", async () => {
    // Direct syncOne with a LIVE cfg → the live adapter refuses (not wired).
    const failed = await syncOne(prisma, ORG_ID, { provider: PROVIDER_LIVE, mode: "live", glMappings: null }, "Invoice", invId);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.status).toBe("FAILED");
    const failedRow = await logFor(PROVIDER_LIVE, "Invoice", invId);
    expect(failedRow?.status).toBe(SyncStatus.FAILED);
    expect(failedRow?.error).toContain("blocker");
    expect(alerts.some((a) => a.code === "accounting.sync_failed")).toBe(true);

    // Admin "fixes" the config (sandbox) and retries → clears, one row.
    const fixed = await syncOne(prisma, ORG_ID, { provider: PROVIDER_LIVE, mode: "sandbox", glMappings: null }, "Invoice", invId);
    expect(fixed.ok).toBe(true);
    const clearedRow = await logFor(PROVIDER_LIVE, "Invoice", invId);
    expect(clearedRow?.status).toBe(SyncStatus.SANDBOX);
    expect(clearedRow?.externalId).not.toBeNull();

    // Re-run → ALREADY_SYNCED, same externalId (idempotent, no duplicate).
    const again = await syncOne(prisma, ORG_ID, { provider: PROVIDER_LIVE, mode: "sandbox", glMappings: null }, "Invoice", invId);
    expect(again.ok && again.status).toBe("ALREADY_SYNCED");
    const rows = await prisma.accountingSyncLog.findMany({ where: { provider: PROVIDER_LIVE, entityType: "Invoice", entityId: invId } });
    expect(rows).toHaveLength(1);
    expect(again.ok && again.externalId).toBe(clearedRow?.externalId);
  });
});

describe("reconciliation view (T-9, FR-6, AC-7)", () => {
  it("reports per-provider status for an admin", async () => {
    await enqueueSync(prisma, ORG_ID, "Invoice", invId);
    await syncWorker(prisma, { providers: [PROVIDER] });
    const admin = await actAs(USER_ADMIN_ID);
    const recon = await reconciliation(admin);
    const mine = recon.providers.find((p) => p.provider === PROVIDER);
    expect(mine).toBeDefined();
    expect(mine!.sandbox).toBeGreaterThanOrEqual(1);
  });

  it("denies reconciliation to a role without integration:manage (AC-12)", async () => {
    const manager = await actAs(USER_MANAGER_ID);
    await expect(reconciliation(manager)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("config + retry RBAC (T-8, FR-7/8, AC-8/12)", () => {
  it("a non-admin cannot configure accounting or retry (FORBIDDEN)", async () => {
    await actAs(USER_MANAGER_ID);
    const cfg = await configureAccounting({ provider: "zoho", mode: "sandbox" });
    expect(cfg.ok).toBe(false);
    if (!cfg.ok) expect(cfg.error.code).toBe("FORBIDDEN");

    const retry = await retrySync({ logId: "whatever" });
    expect(retry.ok).toBe(false);
    if (!retry.ok) expect(retry.error.code).toBe("FORBIDDEN");
  });

  it("an admin switches provider/mode — config not code (AC-8)", async () => {
    await actAs(USER_ADMIN_ID);
    const created = await configureAccounting({ provider: "tally", mode: "sandbox" });
    expect(created.ok).toBe(true);
    if (created.ok) expect(created.data.provider).toBe("tally");

    // Flip the same provider to live — a pure config change, persisted.
    const flipped = await configureAccounting({ provider: "tally", mode: "live", credentialsRef: "vault://tally" });
    expect(flipped.ok).toBe(true);
    const row = await prisma.accountingConfig.findUnique({ where: { orgId_provider: { orgId: ORG_ID, provider: "tally" } } });
    expect(row?.mode).toBe("live");
    expect(row?.credentialsRef).toBe("vault://tally");
  });
});
