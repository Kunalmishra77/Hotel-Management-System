/**
 * Live-gated adapters — 22 T-3.
 *
 * These are the seams for the real accounting systems. Each is HONEST about the
 * external blocker the client must clear before it can post a single live
 * document (integrations.md — "be honest in specs about the live blocker"):
 *
 *   Zoho Books — a Zoho OAuth app (client id/secret) authorized against the
 *     client's Books organization; without it every API call is refused upstream.
 *   Tally      — a Tally Prime/ERP connector running on the client's own machine
 *     (ODBC or the HTTP-XML gateway); there is no cloud endpoint to reach.
 *
 * They are intentionally not wired to an SDK here: the app never needs them to
 * run (the mock covers every path), and wiring them without the above would be
 * dishonest. When the client completes onboarding, implement `push*` against the
 * SDK behind this same interface — no call-site changes (FR-1/7). Returning a
 * failed result (rather than throwing) keeps the worker's retry/dead-letter path
 * in control (FR-5).
 */
import type {
  AccountingDoc,
  AccountingProvider,
  AccountingPushResult,
  AccountingReconcileRef,
  AccountingReconcileResult,
} from "./types";
import { accountingLiveBlockerFor } from "./types";

export function liveAccountingProvider(provider: string): AccountingProvider {
  const notWired = async (_doc: AccountingDoc): Promise<AccountingPushResult> => ({
    ok: false,
    error: `LIVE accounting sync via "${provider}" is not wired — blocker: ${accountingLiveBlockerFor(provider)}`,
  });

  return {
    name: `${provider}:live`,
    provider,
    isLive: true,
    pushInvoice: notWired,
    pushExpense: notWired,
    pushPayment: notWired,
    async reconcile(refs: AccountingReconcileRef[]): Promise<AccountingReconcileResult> {
      // We cannot reconcile against a ledger we cannot yet reach — report all
      // documents as unconfirmed rather than pretend they matched.
      return { checked: refs.length, matched: 0, missing: [...refs] };
    },
  };
}
