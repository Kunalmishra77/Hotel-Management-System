/**
 * Pure mapping: our settled-finance entity → a provider-neutral accounting
 * document — 22 T-4 (FR-2/3). No I/O, no framework imports: deterministic and
 * unit-testable. The loaders (internal.ts) read the DB and hand a normalized
 * record here; this file decides the doc kind, direction, GL account and GST.
 *
 * Direction lives in `kind`, never in a negative amount (data-model.md keeps
 * money positive): a CREDIT_NOTE and a REFUND are contra documents the
 * accounting system journals accordingly, so 22 pushes a credit/adjustment doc —
 * never a second invoice — for a void or a refund (AC-9).
 */
import type {
  AccountingDoc,
  AccountingDocKind,
  AccountingGlMappings,
} from "@/lib/accounting";

/** The idempotency key for a (provider, entity) sync. */
export function syncKey(provider: string, entityType: string, entityId: string): string {
  return `${provider}:${entityType}:${entityId}`;
}

export type { AccountingEntityType } from "@/lib/accounting";

export type InvoiceRecord = {
  entityType: "Invoice";
  id: string;
  number: string;
  invoiceType: "TAX_INVOICE" | "CREDIT_NOTE";
  propertyId: string;
  customerName: string;
  customerGstin: string | null;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  dateISO: string;
  cancelsInvoiceId: string | null;
};

export type ExpenseRecord = {
  entityType: "Expense";
  id: string;
  propertyId: string;
  head: string;
  subCategory: string | null;
  amountPaise: number;
  vendor: string | null;
  dateISO: string;
};

export type PaymentRecord = {
  entityType: "Payment";
  id: string;
  propertyId: string | null;
  amountPaise: number;
  mode: string;
  isRefund: boolean;
  folioId: string | null;
  reference: string | null;
  dateISO: string;
};

export type PayrollRecord = {
  entityType: "Payroll";
  id: string;
  propertyId: string;
  month: string;
  netTotalPaise: number;
  dateISO: string;
};

export type AccountingEntityRecord =
  | InvoiceRecord
  | ExpenseRecord
  | PaymentRecord
  | PayrollRecord;

function base(
  record: AccountingEntityRecord,
  provider: string,
  kind: AccountingDocKind,
  fields: Pick<AccountingDoc, "amountPaise" | "reference" | "narration" | "glAccount"> &
    Partial<Pick<AccountingDoc, "tax" | "customerGstin" | "meta" | "propertyId">>,
): AccountingDoc {
  return {
    provider,
    entityType: record.entityType,
    entityId: record.id,
    syncKey: syncKey(provider, record.entityType, record.id),
    kind,
    propertyId: fields.propertyId ?? ("propertyId" in record ? record.propertyId : null),
    dateISO: record.dateISO,
    amountPaise: fields.amountPaise,
    currency: "INR",
    reference: fields.reference,
    narration: fields.narration,
    glAccount: fields.glAccount,
    tax: fields.tax ?? null,
    customerGstin: fields.customerGstin ?? null,
    meta: fields.meta ?? {},
  };
}

/** Map a normalized entity record to the provider doc, applying GL mappings. */
export function toAccountingDoc(
  record: AccountingEntityRecord,
  provider: string,
  mappings: AccountingGlMappings | null,
): AccountingDoc {
  const gl = mappings ?? {};

  switch (record.entityType) {
    case "Invoice": {
      const isCredit = record.invoiceType === "CREDIT_NOTE";
      const kind: AccountingDocKind = isCredit ? "CREDIT_NOTE" : "INVOICE";
      const glAccount = (isCredit ? gl.creditNote ?? gl.invoice : gl.invoice) ?? null;
      return base(record, provider, kind, {
        amountPaise: record.totalPaise,
        reference: record.number,
        narration: `${isCredit ? "Credit note" : "Tax invoice"} ${record.number} — ${record.customerName}`,
        glAccount,
        customerGstin: record.customerGstin,
        tax: {
          taxablePaise: record.taxableValuePaise,
          cgstPaise: record.cgstPaise,
          sgstPaise: record.sgstPaise,
          igstPaise: record.igstPaise,
        },
        meta: { customerName: record.customerName, cancelsInvoiceId: record.cancelsInvoiceId },
      });
    }
    case "Expense": {
      const glAccount = gl.expense?.[record.head] ?? null;
      return base(record, provider, "EXPENSE", {
        amountPaise: record.amountPaise,
        reference: record.id,
        narration: `Expense — ${record.head}${record.subCategory ? ` / ${record.subCategory}` : ""}`,
        glAccount,
        meta: { head: record.head, subCategory: record.subCategory, vendor: record.vendor },
      });
    }
    case "Payment": {
      const kind: AccountingDocKind = record.isRefund ? "REFUND" : "PAYMENT";
      const glAccount = (record.isRefund ? gl.refund ?? gl.payment : gl.payment) ?? null;
      return base(record, provider, kind, {
        amountPaise: record.amountPaise,
        reference: record.reference ?? record.id,
        narration: `${record.isRefund ? "Refund" : "Payment received"} (${record.mode})`,
        glAccount,
        meta: { mode: record.mode, folioId: record.folioId, isRefund: record.isRefund },
      });
    }
    case "Payroll": {
      return base(record, provider, "PAYROLL_JOURNAL", {
        amountPaise: record.netTotalPaise,
        reference: record.month,
        narration: `Salary journal — ${record.month}`,
        glAccount: gl.payroll ?? null,
        meta: { month: record.month },
      });
    }
  }
}
