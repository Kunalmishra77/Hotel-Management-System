/**
 * Reports registers (client, 22 Nov 2026) reconcile with the folio — the register
 * never re-estimates money: bill = Σ active charges + GST, paid = Σ payments −
 * refunds, balance = the folio balance (business-rules §6/§21).
 */
import { vi } from "vitest";
import { afterAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

const authMock = vi.hoisted(() => ({ current: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => authMock.current }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { PROP_A_ID, USER_ACCOUNTS_ID, USER_HOUSEKEEPING_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { bookingRegister, collectionsRegister } from "@/features/reports/register-queries";
import { getBalance } from "@/features/billing";
import { localDayInstants } from "@/lib/local-day";

const prisma = createPrismaClient();
afterAll(async () => { await prisma.$disconnect(); });
const from = new Date("2020-01-01T00:00:00.000Z");
const to = new Date("2035-12-31T00:00:00.000Z");

describe("booking register reconciles with the folio", () => {
  it("bill / paid / balance match the folio for every booking", async () => {
    const user = (await assembleClaims(prisma, USER_ACCOUNTS_ID))!;
    authMock.current = user;
    const rows = await bookingRegister(user, { propertyIds: [PROP_A_ID], from, to, basis: "checkin" });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows.slice(0, 25)) {
      expect(r.billPaise).toBe(r.chargesPaise + r.taxPaise);
      expect(r.balancePaise).toBe(r.billPaise - r.paidPaise);
      const folio = await prisma.folio.findUnique({ where: { reservationId: r.reservationId }, select: { id: true } });
      if (!folio) { expect(r.billPaise).toBe(0); continue; }
      const bal = await getBalance(user, r.reservationId);
      expect(r.balancePaise).toBe(bal);
    }
  });

  it("the three bases select different sets and 'stay' includes every check-in in range", async () => {
    const user = (await assembleClaims(prisma, USER_ACCOUNTS_ID))!;
    const a = await bookingRegister(user, { propertyIds: [PROP_A_ID], from, to, basis: "checkin" });
    const s = await bookingRegister(user, { propertyIds: [PROP_A_ID], from, to, basis: "stay" });
    const ids = new Set(s.map((r) => r.reservationId));
    expect(a.every((r) => ids.has(r.reservationId))).toBe(true);
  });

  it("housekeeping cannot read it (report:view-financial)", async () => {
    const hk = (await assembleClaims(prisma, USER_HOUSEKEEPING_ID))!;
    await expect(bookingRegister(hk, { propertyIds: [PROP_A_ID], from, to, basis: "checkin" })).rejects.toThrow();
  });
});

describe("collections register = the payments table", () => {
  it("sums to Σ payments − refunds in the range", async () => {
    const user = (await assembleClaims(prisma, USER_ACCOUNTS_ID))!;
    const rows = await collectionsRegister(user, { propertyIds: [PROP_A_ID], from, to });
    const range = { gte: localDayInstants(from).start, lt: localDayInstants(to).next };
    const [inSum, outSum] = await Promise.all([false, true].map((isRefund) =>
      prisma.payment.aggregate({ where: { propertyId: PROP_A_ID, isRefund, receivedAt: range }, _sum: { amountPaise: true } })));
    const expected = Number(inSum!._sum.amountPaise ?? 0n) - Number(outSum!._sum.amountPaise ?? 0n);
    expect(rows.reduce((n, r) => n + r.amountPaise, 0)).toBe(expected);
  });
});
