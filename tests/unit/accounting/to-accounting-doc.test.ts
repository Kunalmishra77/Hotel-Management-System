/** 22 T-4 — toAccountingDoc mapping + syncKey (pure). FR-2/3, AC-9. */
import { describe, expect, it } from "vitest";
import {
  syncKey,
  toAccountingDoc,
  type ExpenseRecord,
  type InvoiceRecord,
  type PaymentRecord,
  type PayrollRecord,
} from "@/features/accounting/domain/to-accounting-doc";
import type { AccountingGlMappings } from "@/lib/accounting";

const MAP: AccountingGlMappings = {
  invoice: "Sales",
  creditNote: "Sales Returns",
  payment: "Bank",
  refund: "Bank",
  payroll: "Salaries",
  expense: { KITCHEN: "Kitchen & F&B" },
};

const invoice: InvoiceRecord = {
  entityType: "Invoice",
  id: "inv1",
  number: "WMG/26-27/014",
  invoiceType: "TAX_INVOICE",
  propertyId: "p1",
  customerName: "Ravi",
  customerGstin: "29ABCDE1234F1Z5",
  taxableValuePaise: 1_200_000,
  cgstPaise: 108_000,
  sgstPaise: 108_000,
  igstPaise: 0,
  totalPaise: 1_341_000,
  dateISO: "2026-07-01",
  cancelsInvoiceId: null,
};

describe("syncKey", () => {
  it("is the stable (provider, entityType, entityId) idempotency key", () => {
    expect(syncKey("zoho", "Invoice", "inv1")).toBe("zoho:Invoice:inv1");
  });
});

describe("toAccountingDoc — invoices (AC-9: void ⇒ credit note, not a 2nd invoice)", () => {
  it("maps a tax invoice with GST breakup + GL account", () => {
    const doc = toAccountingDoc(invoice, "zoho", MAP);
    expect(doc.kind).toBe("INVOICE");
    expect(doc.amountPaise).toBe(1_341_000);
    expect(doc.reference).toBe("WMG/26-27/014");
    expect(doc.glAccount).toBe("Sales");
    expect(doc.customerGstin).toBe("29ABCDE1234F1Z5");
    expect(doc.tax).toEqual({ taxablePaise: 1_200_000, cgstPaise: 108_000, sgstPaise: 108_000, igstPaise: 0 });
    expect(doc.syncKey).toBe("zoho:Invoice:inv1");
  });

  it("maps a credit note to a contra doc (CREDIT_NOTE), not a second invoice", () => {
    const credit: InvoiceRecord = { ...invoice, id: "cn1", invoiceType: "CREDIT_NOTE", cancelsInvoiceId: "inv1", number: "WMG/26-27/C-002" };
    const doc = toAccountingDoc(credit, "zoho", MAP);
    expect(doc.kind).toBe("CREDIT_NOTE");
    expect(doc.glAccount).toBe("Sales Returns");
    expect(doc.meta.cancelsInvoiceId).toBe("inv1");
  });
});

describe("toAccountingDoc — expense / payment / refund / payroll", () => {
  it("maps an expense to the head's GL account (fallback null when unmapped)", () => {
    const exp: ExpenseRecord = { entityType: "Expense", id: "e1", propertyId: "p1", head: "KITCHEN", subCategory: "Vegetables", amountPaise: 120_000, vendor: "Local Mandi", dateISO: "2026-07-02" };
    const doc = toAccountingDoc(exp, "zoho", MAP);
    expect(doc.kind).toBe("EXPENSE");
    expect(doc.amountPaise).toBe(120_000);
    expect(doc.glAccount).toBe("Kitchen & F&B");

    const unmapped = toAccountingDoc({ ...exp, head: "MISC" }, "zoho", MAP);
    expect(unmapped.glAccount).toBeNull();
  });

  it("maps a received payment to PAYMENT and a refund to REFUND (contra)", () => {
    const pay: PaymentRecord = { entityType: "Payment", id: "pay1", propertyId: "p1", amountPaise: 500_000, mode: "UPI", isRefund: false, folioId: "f1", reference: "txn-1", dateISO: "2026-07-03" };
    const paid = toAccountingDoc(pay, "zoho", MAP);
    expect(paid.kind).toBe("PAYMENT");
    expect(paid.glAccount).toBe("Bank");
    expect(paid.reference).toBe("txn-1");

    const refund = toAccountingDoc({ ...pay, id: "ref1", isRefund: true, reference: null }, "zoho", MAP);
    expect(refund.kind).toBe("REFUND");
    expect(refund.reference).toBe("ref1");
    expect(refund.glAccount).toBe("Bank");
  });

  it("maps finalized payroll to a salary journal", () => {
    const pr: PayrollRecord = { entityType: "Payroll", id: "run1", propertyId: "p1", month: "2026-07", netTotalPaise: 5_048_100, dateISO: "2026-07-31" };
    const doc = toAccountingDoc(pr, "zoho", MAP);
    expect(doc.kind).toBe("PAYROLL_JOURNAL");
    expect(doc.amountPaise).toBe(5_048_100);
    expect(doc.reference).toBe("2026-07");
    expect(doc.glAccount).toBe("Salaries");
  });

  it("tolerates a null mapping (GL account falls back to null)", () => {
    const doc = toAccountingDoc(invoice, "tally", null);
    expect(doc.glAccount).toBeNull();
    expect(doc.provider).toBe("tally");
  });
});
