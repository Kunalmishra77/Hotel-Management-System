/**
 * specs/06 addendum 22 Nov 2026 — one bill, one number; typed bill number; manual
 * bills. Real DB + the invoice_immutable trigger. Each test makes its own folio
 * (billing rows are append-only).
 */
import { vi } from "vitest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

const authMock = vi.hoisted(() => ({ current: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => {
    if (!authMock.current) throw new Error("no test user set");
    return authMock.current;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { PROP_A_ID, USER_ACCOUNTS_ID, USER_RECEPTION_A_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { postFolioCharge } from "@/features/billing/charge-actions";
import { generateInvoice, voidInvoice } from "@/features/billing/invoice-actions";
import { reviseInvoice } from "@/features/billing/invoice-revise-actions";
import { createManualBill, correctManualBill } from "@/features/billing/manual-bill-actions";
import { searchInvoices, getFolio } from "@/features/billing/queries";
import { parseInvoiceSeq } from "@/features/billing/domain/invoice-number";

const prisma = createPrismaClient();
async function actAs(userId: string): Promise<SessionClaims> {
  const claims = await assembleClaims(prisma, userId);
  if (!claims) throw new Error(`no claims for ${userId}`);
  authMock.current = claims;
  return claims;
}
async function folioWithCharge(unitPaise = 100_000): Promise<string> {
  const f = await prisma.folio.create({ data: { propertyId: PROP_A_ID, kind: "DIRECT_SALE", reservationId: null }, select: { id: true } });
  const r = await postFolioCharge({ folioId: f.id, type: "LAUNDRY", description: "Laundry", unitPaise });
  if (!r.ok) throw new Error(r.error.message);
  return f.id;
}
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

beforeEach(() => { authMock.current = null; });
afterAll(async () => { await prisma.$disconnect(); });

describe("FR-RV-1 — Correct bill keeps the number", () => {
  it("re-issues the same number as revision 1, supersedes rev 0, keeps the date", async () => {
    await actAs(USER_ACCOUNTS_ID);
    const folioId = await folioWithCharge();
    const first = await generateInvoice({ folioId, customerName: "Ravi Kumar" });
    if (!first.ok) throw new Error(first.error.message);
    await postFolioCharge({ folioId, type: "FOOD", description: "Dinner", unitPaise: 50_000 });
    const fixed = await reviseInvoice({ invoiceId: first.data.invoiceId, customerName: "Acme Pvt Ltd", customerGstin: "29AAHCT9474D1Z0", customerAddress: "MG Road, Bengaluru", customerState: "Karnataka", guestName: "Ravi Kumar", reason: "company bill + dinner" });
    if (!fixed.ok) throw new Error(fixed.error.message);
    expect(fixed.data.number).toBe(first.data.number);
    expect(fixed.data.revision).toBe(1);
    expect(fixed.data.totalPaise).toBe(157_500); // (1,000 + 500) + 5%
    const old = await prisma.invoice.findUniqueOrThrow({ where: { id: first.data.invoiceId } });
    const neu = await prisma.invoice.findUniqueOrThrow({ where: { id: fixed.data.invoiceId } });
    expect(old.supersededById).toBe(neu.id);
    expect(neu.issuedAt.getTime()).toBe(old.issuedAt.getTime());
    expect(neu).toMatchObject({ customerGstin: "29AAHCT9474D1Z0", customerAddress: "MG Road, Bengaluru", guestName: "Ravi Kumar" });
    // The folio and the register show only the current revision.
    const claims = await actAs(USER_ACCOUNTS_ID);
    const folio = await getFolio(claims, folioId);
    expect(folio?.invoices.map((i) => i.id)).toEqual([neu.id]);
    const reg = await searchInvoices(claims, { keyword: first.data.number, limit: 10 });
    expect(reg.invoices.map((i) => i.id)).toEqual([neu.id]);
    // Correcting the superseded copy again is refused.
    const again = await reviseInvoice({ invoiceId: first.data.invoiceId, customerName: "X", reason: "again" });
    expect(again.ok).toBe(false);
    // The trigger refuses re-pointing a superseded invoice.
    await expect(prisma.invoice.update({ where: { id: old.id }, data: { supersededById: null } })).rejects.toThrow(/APPEND_ONLY/);
  });

  it("reception cannot correct a bill (invoice:void, elevated)", async () => {
    await actAs(USER_ACCOUNTS_ID);
    const folioId = await folioWithCharge();
    const inv = await generateInvoice({ folioId, customerName: "Guest" });
    if (!inv.ok) throw new Error(inv.error.message);
    await actAs(USER_RECEPTION_A_ID);
    const res = await reviseInvoice({ invoiceId: inv.data.invoiceId, customerName: "Other", reason: "x" });
    expect(res.ok).toBe(false);
  });

  it("FR-RV-2: re-issuing after a credit note reuses the cancelled bill's number", async () => {
    await actAs(USER_ACCOUNTS_ID);
    const folioId = await folioWithCharge();
    const inv = await generateInvoice({ folioId, customerName: "Guest" });
    if (!inv.ok) throw new Error(inv.error.message);
    const cn = await voidInvoice({ invoiceId: inv.data.invoiceId, reason: "stay cancelled" });
    expect(cn.ok).toBe(true);
    const again = await generateInvoice({ folioId, customerName: "Guest" });
    if (!again.ok) throw new Error(again.error.message);
    expect(again.data.number).toBe(inv.data.number);
  });
});

describe("FR-RV-3 — typed bill number", () => {
  it("accepts a free number and refuses one another bill already uses", async () => {
    await actAs(USER_ACCOUNTS_ID);
    const seq = 900_000 + (Date.now() % 90_000);
    const a = await generateInvoice({ folioId: await folioWithCharge(), customerName: "A", seq });
    if (!a.ok) throw new Error(a.error.message);
    expect(parseInvoiceSeq(a.data.number)).toBe(seq);
    const b = await generateInvoice({ folioId: await folioWithCharge(), customerName: "B", seq });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error.message).toMatch(/already used/);
    // Auto-numbering never lands on a typed number.
    const c = await generateInvoice({ folioId: await folioWithCharge(), customerName: "C" });
    if (!c.ok) throw new Error(c.error.message);
    expect(c.data.number).not.toBe(a.data.number);
  });
});

describe("FR-MB-1 — manual bill", () => {
  it("creates a bill with exact inclusive totals, no stay, and corrects it under the same number", async () => {
    const claims = await actAs(USER_ACCOUNTS_ID);
    const res = await createManualBill({
      propertyId: PROP_A_ID, billDate: today, customerName: "Talent Loan Technologies", customerGstin: "07AAHCT9474D1Z0",
      customerAddress: "Okhla Phase 2, New Delhi", customerState: "Delhi", paidMode: "UPI",
      lines: [
        { description: "Room stay", hsnSac: "996311", quantity: 2, ratePaise: 240_000, gstBps: 500, inclusive: true },
        { description: "Hall / event", hsnSac: "997212", quantity: 3, ratePaise: 99_900, gstBps: 1800, inclusive: true },
      ],
    });
    if (!res.ok) throw new Error(res.error.message);
    expect(res.data.totalPaise).toBe(480_000 + 299_700);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: res.data.invoiceId }, include: { folio: { include: { payments: true } } } });
    expect(inv.folio.kind).toBe("MANUAL");
    expect(inv.folio.reservationId).toBeNull();
    expect(inv.customerAddress).toBe("Okhla Phase 2, New Delhi");
    expect(inv.folio.payments.map((p) => Number(p.amountPaise))).toEqual([779_700]);
    const reg = await searchInvoices(claims, { keyword: res.data.number, limit: 5 });
    expect(reg.invoices[0]?.manual).toBe(true);

    const fixed = await correctManualBill({
      invoiceId: res.data.invoiceId, billDate: today, customerName: "Talent Loan Technologies Pvt Ltd", customerGstin: "07AAHCT9474D1Z0",
      customerAddress: "Okhla Phase 2, New Delhi", reason: "name + rate",
      lines: [{ description: "Room stay", hsnSac: "996311", quantity: 1, ratePaise: 300_000, gstBps: 500, inclusive: false }],
    });
    if (!fixed.ok) throw new Error(fixed.error.message);
    expect(fixed.data.number).toBe(res.data.number);
    expect(fixed.data.totalPaise).toBe(315_000);
    const lines = await prisma.folioLine.findMany({ where: { folioId: inv.folioId } });
    const net = lines.reduce((n, l) => n + Number(l.amountPaise) + l.cgstPaise + l.sgstPaise + l.igstPaise, 0);
    expect(net).toBe(315_000); // old lines reversed, new line posted
  });

  it("refuses a future-dated bill and a bad GSTIN", async () => {
    await actAs(USER_ACCOUNTS_ID);
    const future = await createManualBill({ propertyId: PROP_A_ID, billDate: "2999-01-01", customerName: "X", lines: [{ description: "x", quantity: 1, ratePaise: 100, gstBps: 0, inclusive: false }] });
    expect(future.ok).toBe(false);
    const bad = await createManualBill({ propertyId: PROP_A_ID, billDate: today, customerName: "X", customerGstin: "12345", lines: [{ description: "x", quantity: 1, ratePaise: 100, gstBps: 0, inclusive: false }] });
    expect(bad.ok).toBe(false);
  });
});
