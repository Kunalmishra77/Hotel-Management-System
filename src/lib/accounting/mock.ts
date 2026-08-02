/**
 * The default MockAccountingProvider — 22 T-3 (FR-4, integrations.md sandbox rule).
 *
 * Performs NO external call. `push*` returns a deterministic `mock-*` externalId
 * and success, so the enqueue → syncWorker → log path runs identically to
 * production and the whole app works with zero external accounts. `reconcile`
 * treats everything recorded as present (there is no external ledger to diverge
 * from in sandbox).
 */
import { randomUUID } from "node:crypto";
import type {
  AccountingDoc,
  AccountingProvider,
  AccountingPushResult,
  AccountingReconcileRef,
  AccountingReconcileResult,
} from "./types";

export function mockAccountingProvider(provider: string): AccountingProvider {
  const push = async (doc: AccountingDoc): Promise<AccountingPushResult> => ({
    // Deterministic shape; no network. The document never leaves the process.
    ok: true,
    externalId: `mock-${provider}-${doc.entityType.toLowerCase()}-${randomUUID()}`,
  });

  return {
    name: `mock:${provider}`,
    provider,
    isLive: false,
    pushInvoice: push,
    pushExpense: push,
    pushPayment: push,
    async reconcile(refs: AccountingReconcileRef[]): Promise<AccountingReconcileResult> {
      return { checked: refs.length, matched: refs.length, missing: [] };
    },
  };
}
