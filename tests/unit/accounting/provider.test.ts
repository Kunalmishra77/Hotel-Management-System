/** 22 T-3 — AccountingProvider mock contract + provider selection + live honesty. */
import { describe, expect, it } from "vitest";
import { mockAccountingProvider } from "@/lib/accounting/mock";
import { liveAccountingProvider } from "@/lib/accounting/live";
import { resolveAccountingProvider, accountingLiveBlockerFor, type AccountingDoc } from "@/lib/accounting";

function doc(kind: AccountingDoc["kind"], entityType: AccountingDoc["entityType"]): AccountingDoc {
  return {
    provider: "zoho",
    entityType,
    entityId: "e1",
    syncKey: `zoho:${entityType}:e1`,
    kind,
    propertyId: "p1",
    dateISO: "2026-07-01",
    amountPaise: 1_341_000,
    currency: "INR",
    reference: "WMG/26-27/014",
    narration: "x",
    glAccount: "Sales",
    tax: null,
    customerGstin: null,
    meta: {},
  };
}

describe("MockAccountingProvider (FR-4)", () => {
  it("pushes with NO external call and a deterministic mock externalId", async () => {
    const m = mockAccountingProvider("zoho");
    expect(m.isLive).toBe(false);

    const inv = await m.pushInvoice(doc("INVOICE", "Invoice"));
    expect(inv.ok).toBe(true);
    if (inv.ok) expect(inv.externalId.startsWith("mock-zoho-invoice-")).toBe(true);

    const exp = await m.pushExpense(doc("EXPENSE", "Expense"));
    expect(exp.ok).toBe(true);
    const pay = await m.pushPayment(doc("PAYMENT", "Payment"));
    expect(pay.ok).toBe(true);
  });

  it("reconcile treats everything recorded as present in sandbox", async () => {
    const m = mockAccountingProvider("zoho");
    const r = await m.reconcile([{ entityType: "Invoice", entityId: "e1", externalId: "x" }]);
    expect(r).toEqual({ checked: 1, matched: 1, missing: [] });
  });
});

describe("resolveAccountingProvider selection (FR-1/7)", () => {
  it("resolves the mock for sandbox (or any non-live mode)", () => {
    expect(resolveAccountingProvider({ provider: "zoho", mode: "sandbox" }).isLive).toBe(false);
    expect(resolveAccountingProvider({ provider: "tally", mode: "test" }).isLive).toBe(false);
  });

  it("resolves the live adapter only for an explicit live mode", () => {
    expect(resolveAccountingProvider({ provider: "zoho", mode: "live" }).isLive).toBe(true);
  });
});

describe("live adapter honesty (integrations.md)", () => {
  it("refuses to push and names the blocker for zoho and tally", async () => {
    const zoho = liveAccountingProvider("zoho");
    const zr = await zoho.pushInvoice(doc("INVOICE", "Invoice"));
    expect(zr.ok).toBe(false);
    if (!zr.ok) expect(zr.error).toContain(accountingLiveBlockerFor("zoho"));

    const tally = liveAccountingProvider("tally");
    const tr = await tally.pushExpense(doc("EXPENSE", "Expense"));
    expect(tr.ok).toBe(false);
    if (!tr.ok) expect(tr.error).toContain(accountingLiveBlockerFor("tally"));

    // reconcile against an unreachable ledger reports everything unconfirmed.
    const rc = await zoho.reconcile([{ entityType: "Invoice", entityId: "e1", externalId: "x" }]);
    expect(rc).toEqual({ checked: 1, matched: 0, missing: [{ entityType: "Invoice", entityId: "e1", externalId: "x" }] });
  });

  it("falls back to a generic blocker for an unknown provider", () => {
    expect(accountingLiveBlockerFor("nope")).toMatch(/accounting-system account/i);
  });
});
