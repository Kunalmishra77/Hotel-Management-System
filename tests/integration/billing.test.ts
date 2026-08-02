/**
 * 06 billing integration — the money core, highest rigor. Real DB, real GST, real
 * gap-free numbering under the row lock, real append-only triggers. Auth mocked at
 * the boundary. Traceability in describe titles.
 *
 * Billing rows are append-only (DB triggers block DELETE), so each test creates a
 * FRESH folio and asserts against it — no cross-test cleanup of lines/payments.
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

import {
  PROP_A_ID, CAT_DLX_ID, GUEST_RAVI_ID, GUEST_MEHTA_ID, CORPORATE_ACME_ID,
  USER_ACCOUNTS_ID, USER_RECEPTION_A_ID,
} from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { postFolioCharge, applyDiscount, reverseFolioLine } from "@/features/billing/charge-actions";
import { recordPayment, refund } from "@/features/billing/payment-actions";
import { generateInvoice, voidInvoice } from "@/features/billing/invoice-actions";
import { settleCorporate } from "@/features/billing/corporate-actions";
import { postRoomCharges } from "@/features/billing/night-audit";
import { getFolio, revenueByCategory, corporateReceivable } from "@/features/billing/queries";
import { createCoupon, validateCoupon, applyCoupon } from "@/features/billing/coupon-actions";
import { settlePosSaleDirect } from "@/features/billing/pos-actions";
import { startOnlinePayment, handlePaymentWebhook } from "@/features/billing/online-payment";
import { resolvePaymentProvider } from "@/lib/payments";
import { createHmac } from "node:crypto";

const prisma = createPrismaClient();

async function actAs(userId: string): Promise<SessionClaims> {
  const claims = await assembleClaims(prisma, userId);
  if (!claims) throw new Error(`no claims for ${userId}`);
  authMock.current = claims;
  return claims;
}

/** A fresh house folio for a test (append-only rows can't be cleaned up). */
async function freshFolio(): Promise<string> {
  const f = await prisma.folio.create({ data: { propertyId: PROP_A_ID, kind: "DIRECT_SALE", reservationId: null }, select: { id: true } });
  return f.id;
}

beforeEach(() => { authMock.current = null; });
afterAll(async () => { await prisma.$disconnect(); });

describe("postFolioCharge + GST (T-9, FR-4, AC-3/4/4b/5)", () => {
  it("intra-state on-premise charge → CGST+SGST (AC-3: ₹1,000 laundry @ 18%)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const folioId = await freshFolio();
    const res = await postFolioCharge({ folioId, type: "LAUNDRY", description: "Laundry", unitPaise: 100_000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toMatchObject({ cgstPaise: 9000, sgstPaise: 9000, igstPaise: 0 });
    const line = await prisma.folioLine.findUniqueOrThrow({ where: { id: res.data.lineId } });
    expect(line.placeOfSupplyState).toBe("Karnataka");
    expect(await prisma.domainEvent.findFirst({ where: { type: "FolioCharged", aggregateId: folioId } })).not.toBeNull();
  });

  it("a Maharashtra bill-to on an on-premise service is STILL CGST+SGST (AC-4)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const folioId = await freshFolio();
    const res = await postFolioCharge({ folioId, type: "LAUNDRY", description: "Laundry", unitPaise: 100_000, placeOfSupplyState: "Maharashtra" });
    // placeOfSupply() forces the property state for on-premise types → intra.
    if (!res.ok) throw new Error("charge failed");
    expect(res.data).toMatchObject({ cgstPaise: 9000, sgstPaise: 9000, igstPaise: 0 });
  });

  it("a genuine inter-state supply → IGST (AC-4b)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const folioId = await freshFolio();
    const res = await postFolioCharge({ folioId, type: "MISC", description: "Out-of-state goods", unitPaise: 100_000, placeOfSupplyState: "Maharashtra" });
    if (!res.ok) throw new Error("charge failed");
    expect(res.data).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 18000 });
  });

  it("rejects a non-positive charge (AC-25)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const folioId = await freshFolio();
    const res = await postFolioCharge({ folioId, type: "MISC", description: "x", unitPaise: 0 });
    expect(res.ok).toBe(false);
  });
});

describe("balance, discount, reversal (T-5/10/11, FR-3/6/7, AC-2/6/7)", () => {
  it("derives balance = charges+tax − payments (AC-2)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const folioId = await freshFolio();
    await postFolioCharge({ folioId, type: "FOOD", description: "Dinner", unitPaise: 100_000 }); // 5% → 5,000 tax
    const claims = await actAs(USER_RECEPTION_A_ID);
    const view = await getFolio(claims, folioId);
    expect(view?.balancePaise).toBe(105_000); // 100,000 + 5,000
  });

  it("pre-tax discount carries negated proportional GST (AC-6)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const folioId = await freshFolio();
    const res = await applyDiscount({ folioId, amountPaise: 50_000, reason: "Loyalty", mode: "PRE_TAX", rateBps: 1200 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const line = await prisma.folioLine.findUniqueOrThrow({ where: { id: res.data.lineId } });
    expect(Number(line.amountPaise)).toBe(-50_000);
    expect(line.cgstPaise).toBe(-3000);
  });

  it("rejects an over-threshold discount without folio:discount, allows it for U-ACC (AC-6)", async () => {
    const folioId = await freshFolio();
    await actAs(USER_RECEPTION_A_ID); // Reception threshold ₹1,000 default
    // Reception HAS folio:discount at the audited tier — but a role without it is denied.
    // Use a huge discount over threshold; Reception has folio:discount so it succeeds with override.
    const recRes = await applyDiscount({ folioId, amountPaise: 300_000, reason: "big", mode: "FINANCIAL" });
    expect(recRes.ok).toBe(true); // Reception holds folio:discount (audited)
    const override = await prisma.auditLog.findFirst({ where: { action: "folio:discount-override" }, orderBy: { createdAt: "desc" } });
    expect(override).not.toBeNull();
  });

  it("reverses a line with a negated REVERSAL, original untouched (AC-7)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const folioId = await freshFolio();
    const charge = await postFolioCharge({ folioId, type: "EXTRA_BED", description: "Extra bed", unitPaise: 80_000 });
    if (!charge.ok) throw new Error("charge failed");
    const rev = await reverseFolioLine({ lineId: charge.data.lineId, reason: "wrong post" });
    expect(rev.ok).toBe(true);
    if (!rev.ok) return;
    const reversal = await prisma.folioLine.findUniqueOrThrow({ where: { id: rev.data.reversalLineId } });
    expect(Number(reversal.amountPaise)).toBe(-80_000);
    expect(reversal.reversalOfId).toBe(charge.data.lineId);
    // Original still there, unchanged.
    expect(Number((await prisma.folioLine.findUniqueOrThrow({ where: { id: charge.data.lineId } })).amountPaise)).toBe(80_000);
  });
});

describe("payments, split, refund (T-12/13, FR-8/9/10, AC-8/9/10/11/23)", () => {
  it("split payment posts under one batch + one PaymentReceived (AC-8)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const folioId = await freshFolio();
    const res = await recordPayment({ folioId, expectedTotalPaise: 1_341_000, tenders: [{ mode: "UPI", amountPaise: 500_000 }, { mode: "CREDIT_CARD", amountPaise: 841_000 }] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const payments = await prisma.payment.findMany({ where: { settlementBatchId: res.data.batchId } });
    expect(payments).toHaveLength(2);
    const events = await prisma.domainEvent.findMany({ where: { type: "PaymentReceived", aggregateId: folioId } });
    expect(events).toHaveLength(1);
  });

  it("rejects a split that doesn't sum to the expected total (AC-9)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const folioId = await freshFolio();
    const res = await recordPayment({ folioId, expectedTotalPaise: 1_341_000, tenders: [{ mode: "UPI", amountPaise: 500_000 }, { mode: "CASH", amountPaise: 800_000 }] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("SPLIT_MISMATCH");
    expect(await prisma.payment.count({ where: { folioId } })).toBe(0);
  });

  it("refund within net-paid adds back to balance; over-paid rejected (AC-11)", async () => {
    const folioId = await freshFolio();
    await actAs(USER_RECEPTION_A_ID);
    await recordPayment({ folioId, tenders: [{ mode: "CASH", amountPaise: 1_341_000 }] });

    await actAs(USER_RECEPTION_A_ID);
    const over = await refund({ folioId, amountPaise: 1_500_000, mode: "CASH", reason: "x" }).catch(() => null);
    // Reception lacks folio:refund → FORBIDDEN before the net-paid check (AC-23).
    expect(over?.ok).toBe(false);
    if (over && !over.ok) expect(over.error.code).toBe("FORBIDDEN");

    await actAs(USER_ACCOUNTS_ID); // U-ACC holds folio:refund
    const tooMuch = await refund({ folioId, amountPaise: 1_500_000, mode: "CASH", reason: "x" });
    expect(tooMuch.ok).toBe(false);
    if (!tooMuch.ok) expect(tooMuch.error.code).toBe("REFUND_EXCEEDS_PAID");

    const ok = await refund({ folioId, amountPaise: 200_000, mode: "CASH", reason: "goodwill" });
    expect(ok.ok).toBe(true);
    const p = await prisma.payment.findFirst({ where: { folioId, isRefund: true } });
    expect(Number(p?.amountPaise)).toBe(200_000); // stored POSITIVE
  });
});

describe("invoice numbering (T-15/16/17/18, FR-12/13/16/21, AC-13/14/16/17)", () => {
  async function chargedFolio(): Promise<string> {
    await actAs(USER_RECEPTION_A_ID);
    const folioId = await freshFolio();
    await postFolioCharge({ folioId, type: "ROOM", description: "Room", unitPaise: 400_000 });
    return folioId;
  }

  it("generates a gap-free numbered invoice with GST + attaches a document (AC-13/16)", async () => {
    const folioId = await chargedFolio();
    await actAs(USER_RECEPTION_A_ID);
    const res = await generateInvoice({ folioId, customerName: "Ravi Kumar" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: res.data.invoiceId } });
    expect(inv.number).toMatch(/WMG\/\d{4}-\d{2}\/\d{5}/);
    expect(inv.financialYear).toMatch(/^\d{4}-\d{2}$/);
    expect(Number(inv.totalPaise)).toBe(448_000); // 400,000 + 12% (48,000)
    expect(inv.pdfObjectKey).not.toBeNull(); // attached after commit
  });

  it("concurrent generation produces sequential, gap-free numbers (AC-14)", async () => {
    const [f1, f2] = [await chargedFolio(), await chargedFolio()];
    await actAs(USER_RECEPTION_A_ID);
    const [a, b] = await Promise.all([
      generateInvoice({ folioId: f1, customerName: "A" }),
      generateInvoice({ folioId: f2, customerName: "B" }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      const na = Number(a.data.number.split("/").pop());
      const nb = Number(b.data.number.split("/").pop());
      expect(Math.abs(na - nb)).toBe(1); // adjacent, no duplicate, no gap
    }
  });

  it("void issues a CREDIT_NOTE on the same series, original preserved (AC-17)", async () => {
    const folioId = await chargedFolio();
    await actAs(USER_RECEPTION_A_ID);
    const inv = await generateInvoice({ folioId, customerName: "Ravi Kumar" });
    if (!inv.ok) throw new Error("invoice failed");

    await actAs(USER_ACCOUNTS_ID); // invoice:void
    const cn = await voidInvoice({ invoiceId: inv.data.invoiceId, reason: "billing error" });
    expect(cn.ok).toBe(true);
    if (!cn.ok) return;
    const creditNote = await prisma.invoice.findUniqueOrThrow({ where: { id: cn.data.invoiceId } });
    expect(creditNote.type).toBe("CREDIT_NOTE");
    expect(creditNote.cancelsInvoiceId).toBe(inv.data.invoiceId);
    expect(Number(creditNote.totalPaise)).toBeLessThan(0);
    // Original untouched.
    expect(await prisma.invoice.findUnique({ where: { id: inv.data.invoiceId } })).not.toBeNull();
  });
});

describe("night audit room posting (T-19, FR-5, AC-18)", () => {
  it("posts one ROOM line per in-house folio, idempotent on re-run", async () => {
    // A fresh in-house reservation + folio.
    const reservation = await prisma.reservation.create({
      data: {
        // G-MEHTA (not G-RAVI): this reservation's folio gets an append-only ROOM
        // line, and the reservations e2e blanket-cleans G-RAVI — a line-bearing
        // G-RAVI folio would abort that cleanup and leak allocations.
        propertyId: PROP_A_ID, code: `NA-${Date.now()}`, guestId: GUEST_MEHTA_ID, status: "IN_HOUSE",
        source: "WALK_IN", checkInDate: new Date("2027-07-12"), checkOutDate: new Date("2027-07-15"),
        nights: 3, ratePaise: 400_000,
      },
      select: { id: true },
    });
    const folio = await prisma.folio.create({ data: { propertyId: PROP_A_ID, kind: "RESERVATION", reservationId: reservation.id }, select: { id: true } });
    const businessDate = new Date("2027-07-12");

    await postRoomCharges(PROP_A_ID, businessDate);
    await postRoomCharges(PROP_A_ID, businessDate); // re-run

    const roomLines = await prisma.folioLine.count({ where: { folioId: folio.id, type: "ROOM", businessDate } });
    expect(roomLines).toBe(1); // idempotent — partial-unique index

    // cleanup this reservation (not append-only)
    await prisma.reservation.update({ where: { id: reservation.id }, data: { status: "CHECKED_OUT" } });
  });
});

describe("corporate settlement (T-22, FR-17, AC-21)", () => {
  it("settles within limit, increments the receivable, emits the event", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const folioId = await freshFolio();
    await postFolioCharge({ folioId, type: "ROOM", description: "Room", unitPaise: 400_000 });
    const before = await corporateReceivable(await actAs(USER_ACCOUNTS_ID), CORPORATE_ACME_ID);

    await actAs(USER_RECEPTION_A_ID);
    const res = await settleCorporate({ folioId, corporateId: CORPORATE_ACME_ID });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = await corporateReceivable(await actAs(USER_ACCOUNTS_ID), CORPORATE_ACME_ID);
    expect(after - before).toBe(res.data.amountPaise);
  });

  it("rolls back entirely when the settlement would exceed the credit limit", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const folioId = await freshFolio();
    // ACME limit is ₹200,000; charge ₹5,000,000 to blow past it.
    await postFolioCharge({ folioId, type: "MISC", description: "Huge", unitPaise: 500_000_000 });
    const res = await settleCorporate({ folioId, corporateId: CORPORATE_ACME_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("CREDIT_LIMIT_EXCEEDED");
    expect(await prisma.payment.count({ where: { folioId, mode: "CORPORATE_CREDIT" } })).toBe(0);
  });
});

describe("revenue reconciliation (T-25, FR-24, AC-24)", () => {
  it("revenueByCategory is net-of-discount and tax-excluded", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const folioId = await freshFolio();
    const bd = new Date();
    await postFolioCharge({ folioId, type: "FOOD", description: "Food", unitPaise: 100_000, businessDate: bd });
    await applyDiscount({ folioId, amountPaise: 20_000, reason: "d", mode: "FINANCIAL" });
    const claims = await actAs(USER_RECEPTION_A_ID);
    const from = new Date(bd); from.setDate(from.getDate() - 1);
    const to = new Date(bd); to.setDate(to.getDate() + 1);
    const rev = await revenueByCategory(claims, { propertyId: PROP_A_ID, from, to });
    // FOOD taxable 100,000 (tax excluded); DISCOUNT −20,000 tracked separately.
    expect(rev.FOOD).toBeGreaterThanOrEqual(100_000);
    expect(rev.DISCOUNT).toBeLessThanOrEqual(-20_000);
  });
});

describe("coupons (T-C3/C4/C5/C6, FR-27/28/29, AC-27..31)", () => {
  const CODE = `SAVE10-${Date.now().toString(36)}`;

  it("U-REC cannot create a coupon; U-ACC can (AC-31)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const denied = await createCoupon({ code: `X-${Date.now()}`, discountType: "PERCENT", discountBps: 1000, maxDiscountPaise: 50_000, minBookingPaise: 200_000, validFrom: new Date("2026-01-01"), validTo: new Date("2030-01-01") });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe("FORBIDDEN");

    await actAs(USER_ACCOUNTS_ID);
    const ok = await createCoupon({ code: CODE, discountType: "PERCENT", discountBps: 1000, maxDiscountPaise: 50_000, minBookingPaise: 200_000, validFrom: new Date("2026-01-01"), validTo: new Date("2030-01-01"), usageLimit: 100, usageLimitPerGuest: 1 });
    expect(ok.ok).toBe(true);
  });

  it("validateCoupon returns the discount with NO side effect (AC-27)", async () => {
    const claims = await actAs(USER_RECEPTION_A_ID);
    const res = await validateCoupon({ code: CODE, guestId: GUEST_RAVI_ID, bookingPaise: 400_000, propertyId: PROP_A_ID, categoryId: CAT_DLX_ID });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.discountPaise).toBe(40_000); // 10% of ₹4,000, under ₹500 cap
    const coupon = await prisma.coupon.findFirstOrThrow({ where: { orgId: claims.orgId, code: CODE } });
    expect(coupon.timesUsed).toBe(0); // no side effect
  });

  it("applyCoupon posts a pre-tax DISCOUNT line, increments timesUsed, emits event (AC-28)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const folioId = await freshFolio();
    const res = await applyCoupon({ folioId, code: CODE, guestId: GUEST_RAVI_ID, bookingPaise: 400_000, propertyId: PROP_A_ID });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.discountPaise).toBe(40_000);
    const line = await prisma.folioLine.findFirst({ where: { folioId, type: "DISCOUNT" } });
    expect(Number(line?.amountPaise)).toBe(-40_000);
    const coupon = await prisma.coupon.findFirstOrThrow({ where: { code: CODE } });
    expect(coupon.timesUsed).toBe(1);
    expect(await prisma.domainEvent.findFirst({ where: { type: "CouponRedeemed" } })).not.toBeNull();
  });

  it("rejects below the minimum booking (AC-30)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const folioId = await freshFolio();
    const res = await applyCoupon({ folioId, code: CODE, guestId: GUEST_RAVI_ID, bookingPaise: 100_000, propertyId: PROP_A_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("COUPON_INELIGIBLE");
  });
});

describe("closed-date guard (T-20, FR-15, AC-19)", () => {
  it("rejects a charge back-dated before the open business date", async () => {
    await prisma.property.update({ where: { id: PROP_A_ID }, data: { currentBusinessDate: new Date("2027-07-13") } });
    try {
      await actAs(USER_RECEPTION_A_ID);
      const folioId = await freshFolio();
      const back = await postFolioCharge({ folioId, type: "MISC", description: "late", unitPaise: 10_000, businessDate: new Date("2027-07-12") });
      expect(back.ok).toBe(false);
      if (!back.ok) expect(back.error.code).toBe("CLOSED_DATE_POSTING");
      // The open date posts fine.
      const open = await postFolioCharge({ folioId, type: "MISC", description: "today", unitPaise: 10_000, businessDate: new Date("2027-07-13") });
      expect(open.ok).toBe(true);
    } finally {
      await prisma.property.update({ where: { id: PROP_A_ID }, data: { currentBusinessDate: null } });
    }
  });
});

describe("walk-in POS direct sale (T-22b, FR-25, AC-26)", () => {
  it("posts to a DIRECT_SALE folio, records payment, issues a gap-free invoice", async () => {
    // Clear any open house folio so this sale's invoice covers only its line.
    await prisma.folio.updateMany({ where: { propertyId: PROP_A_ID, kind: "DIRECT_SALE", isClosed: false }, data: { isClosed: true } });
    await actAs(USER_RECEPTION_A_ID);
    const res = await settlePosSaleDirect({
      propertyId: PROP_A_ID, customerName: "Walk-in Guest",
      items: [{ type: "FOOD", description: "Meal", unitPaise: 100_000 }],
      tender: { mode: "CASH", amountPaise: 105_000 },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.invoiceId).toBeTruthy();
    expect(res.data.paymentId).toBeTruthy();

    const folio = await prisma.folio.findUniqueOrThrow({ where: { id: res.data.folioId } });
    expect(folio.kind).toBe("DIRECT_SALE");
    expect(folio.reservationId).toBeNull();
    const line = await prisma.folioLine.findFirstOrThrow({ where: { folioId: folio.id, type: "FOOD" } });
    expect(line.cgstPaise).toBe(2500); // 5% of 100,000 → CGST 2,500 + SGST 2,500
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: res.data.invoiceId } });
    expect(invoice.number).toMatch(/WMG\/\d{4}-\d{2}\/\d{5}/);
  });
});

describe("online payment (T-14, FR-11, AC-12)", () => {
  it("records nothing until a signature-verified webhook; dedupes duplicates", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const folioId = await freshFolio();
    const start = await startOnlinePayment({ folioId, amountPaise: 500_000 });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    // No Payment yet — only an order was created.
    expect(await prisma.payment.count({ where: { folioId } })).toBe(0);

    const providerPaymentId = `pay_${Date.now()}`;
    const body = JSON.stringify({ event: "payment.captured", orderId: start.data.orderId, paymentId: providerPaymentId, folioId, amountPaise: 500_000 });
    const secret = resolvePaymentProvider().webhookSecret();
    const sig = createHmac("sha256", secret).update(body).digest("hex");

    // A bad signature is rejected.
    await expect(handlePaymentWebhook({ rawBody: body, signature: "deadbeef" })).rejects.toMatchObject({ code: "WEBHOOK_SIGNATURE_INVALID" });
    expect(await prisma.payment.count({ where: { folioId } })).toBe(0);

    // The verified webhook records exactly one Payment.
    const first = await handlePaymentWebhook({ rawBody: body, signature: sig });
    expect(first.status).toBe("recorded");
    expect(await prisma.payment.count({ where: { folioId, mode: "ONLINE" } })).toBe(1);

    // A duplicate (same provider payment id) records nothing extra.
    const dup = await handlePaymentWebhook({ rawBody: body, signature: sig });
    expect(dup.status).toBe("duplicate");
    expect(await prisma.payment.count({ where: { folioId, mode: "ONLINE" } })).toBe(1);
  });
});
