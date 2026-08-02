/**
 * The provider-agnostic accounting contract — 22 (integrations.md golden rule +
 * `AccountingProvider` contract).
 *
 * Application/domain code depends ONLY on `AccountingProvider`, never on a
 * concrete Tally/Zoho SDK. Swapping a provider or going live is a config change
 * (a different adapter is resolved from `AccountingConfig`), never a code change
 * (FR-1/7). A `mock` provider is the DEFAULT so the whole event → sync flow runs
 * end-to-end with ZERO external accounts (FR-4).
 *
 * HONEST NOTE (integrations.md): neither Tally nor Zoho is reachable without a
 * client-side prerequisite — a Zoho Books OAuth app authorized against the
 * client's Books organization, or a Tally connector running on the client's
 * machine. No code path here fabricates that access; the live adapters refuse to
 * push and name the blocker until the client completes onboarding (FR-1).
 */

/** The four settled-finance entities 22 mirrors into the accounting ledger. */
export type AccountingEntityType = "Invoice" | "Payment" | "Expense" | "Payroll";

/** The document kind the accounting system journals — direction is carried here. */
export type AccountingDocKind =
  | "INVOICE"
  | "CREDIT_NOTE"
  | "PAYMENT"
  | "REFUND"
  | "EXPENSE"
  | "PAYROLL_JOURNAL";

/** GST breakup carried on an invoice/credit-note document (paise). */
export type AccountingTax = {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
};

/**
 * A provider-neutral accounting document. Money is integer paise (data-model.md);
 * `amountPaise` is always positive and `kind` carries the direction (a REFUND or
 * CREDIT_NOTE is a contra entry the accounting system posts accordingly).
 */
export type AccountingDoc = {
  provider: string;
  entityType: AccountingEntityType;
  entityId: string;
  /** The idempotency key = `${provider}:${entityType}:${entityId}`. */
  syncKey: string;
  kind: AccountingDocKind;
  propertyId: string | null;
  /** ISO calendar date (yyyy-mm-dd) the document belongs to. */
  dateISO: string;
  /** Positive integer paise; `kind` carries direction. */
  amountPaise: number;
  /** Single-currency system — always INR (data-model.md). */
  currency: "INR";
  /** Human reference — invoice number, payroll month, entity id. */
  reference: string;
  narration: string;
  /** GL account resolved from config.glMappings, or null to let the provider default. */
  glAccount: string | null;
  /** GST breakup for invoices/credit notes; null otherwise. */
  tax: AccountingTax | null;
  customerGstin: string | null;
  /** Non-sensitive extras for the adapter (never guest PII — compliance.md). */
  meta: Record<string, unknown>;
};

/** Never throws to the caller — always a result, so retry/dead-letter stays in control. */
export type AccountingPushResult = { ok: true; externalId: string } | { ok: false; error: string };

export type AccountingReconcileRef = {
  entityType: AccountingEntityType;
  entityId: string;
  externalId: string;
};
export type AccountingReconcileResult = {
  checked: number;
  matched: number;
  missing: AccountingReconcileRef[];
};

export interface AccountingProvider {
  /** e.g. "mock:zoho", "zoho:live", "tally:live". */
  readonly name: string;
  readonly provider: string;
  /** True only when live credentials AND the client-side prerequisite exist. */
  readonly isLive: boolean;

  /** Push an issued invoice / credit note (the accounting document). */
  pushInvoice(doc: AccountingDoc): Promise<AccountingPushResult>;
  /** Push an expense / salary-journal cost. */
  pushExpense(doc: AccountingDoc): Promise<AccountingPushResult>;
  /** Push a received payment / refund. */
  pushPayment(doc: AccountingDoc): Promise<AccountingPushResult>;
  /** Confirm the given documents exist in the provider's ledger (best-effort). */
  reconcile(refs: AccountingReconcileRef[]): Promise<AccountingReconcileResult>;
}

export type AccountingMode = "sandbox" | "live";

/** Persisted `AccountingConfig.glMappings` shape (untrusted JSON). */
export type AccountingGlMappings = {
  invoice?: string;
  creditNote?: string;
  payment?: string;
  refund?: string;
  payroll?: string;
  /** ExpenseHead → GL account name. */
  expense?: Record<string, string>;
};

/** The external prerequisite a provider needs before it can go live (be honest). */
export const LIVE_BLOCKERS: Record<string, string> = {
  zoho: "A Zoho Books OAuth app (client id + secret) authorized against the client's Books organization",
  tally: "A Tally Prime/ERP connector running on the client's machine (ODBC / HTTP-XML gateway enabled)",
};

export function accountingLiveBlockerFor(provider: string): string {
  return LIVE_BLOCKERS[provider] ?? "The client's accounting-system account + API credentials";
}
