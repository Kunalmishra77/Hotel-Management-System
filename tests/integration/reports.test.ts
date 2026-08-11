/**
 * 08 profit-reports integration — T-2..T-6 (FR-1..8, AC-1/6/7/8/9). Reconciles
 * 06 revenue + 07 expenses + 21 finalized staff cost via 14's metric library.
 * Auth mocked at the boundary. Uses an isolated 2030 month so other tests' folio
 * lines (append-only, un-deletable) never pollute the revenue sum.
 */
import { vi } from "vitest";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

vi.mock("@/lib/auth", () => ({ requireUser: async () => { throw new Error("unused"); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { PROP_A_ID, USER_MANAGER_ID, USER_HOUSEKEEPING_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { profitReport } from "@/features/reports/queries";
import { apportionStaffCost } from "@/features/reports/domain/profit";

const prisma = createPrismaClient();
const created = { expenseIds: [] as string[], payrollIds: [] as string[] };

// Folio lines are APPEND-ONLY (un-deletable), so a fixed test month would
// accumulate revenue across suite runs. Pick a per-run-unique far-future month
// instead — floor(now/60000) is monotonic, so runs >1min apart never share a
// window; the query then only ever sees this run's rows. Space: 900yr × 12mo.
const SLOT = Math.floor(Date.now() / 60_000) % 10_800;
const YEAR = 2100 + Math.floor(SLOT / 12);
const MON = (SLOT % 12) + 1;
const YM = `${YEAR}-${String(MON).padStart(2, "0")}`;
const DAYS_IN_MONTH = new Date(Date.UTC(YEAR, MON, 0)).getUTCDate();
const FROM = new Date(`${YM}-01`);
const TO = new Date(Date.UTC(YEAR, MON - 1, DAYS_IN_MONTH));

async function claims(userId: string): Promise<SessionClaims> {
  const c = await assembleClaims(prisma, userId);
  if (!c) throw new Error("no claims");
  return c;
}

async function seedMonth() {
  const bd = new Date(`${YM}-05`);
  // payroll.test.ts derives its month from the same clock formula and can land on
  // this same YM during the shared collect phase, leaving a PayrollRun that
  // collides with ours on (propertyId, month, sequence). Clear any such leftover
  // first so seedMonth is self-healing regardless of run order.
  await prisma.payrollRun.deleteMany({ where: { propertyId: PROP_A_ID, month: YM } });
  const folio = await prisma.folio.create({ data: { propertyId: PROP_A_ID, kind: "DIRECT_SALE" }, select: { id: true } });
  await prisma.folioLine.create({ data: { folioId: folio.id, type: "ROOM", description: "Rooms", quantity: 1, unitPaise: 60_000_000, amountPaise: 60_000_000n, businessDate: bd } });
  await prisma.folioLine.create({ data: { folioId: folio.id, type: "FOOD", description: "F&B", quantity: 1, unitPaise: 8_000_000, amountPaise: 8_000_000n, businessDate: bd } });
  const e1 = await prisma.expense.create({ data: { propertyId: PROP_A_ID, head: "HOUSEKEEPING", amountPaise: 5_000_000, spentOn: bd, status: "APPROVED" }, select: { id: true } });
  const e2 = await prisma.expense.create({ data: { propertyId: PROP_A_ID, head: "UTILITIES", amountPaise: 16_000_000, spentOn: bd, status: "APPROVED" }, select: { id: true } });
  const pr = await prisma.payrollRun.create({ data: { propertyId: PROP_A_ID, month: YM, netTotalPaise: 15_000_000n, status: "FINALIZED", finalizedAt: new Date() }, select: { id: true } });
  created.expenseIds.push(e1.id, e2.id);
  created.payrollIds.push(pr.id);
}

afterEach(async () => {
  await prisma.expense.deleteMany({ where: { id: { in: created.expenseIds } } });
  await prisma.payrollRun.deleteMany({ where: { id: { in: created.payrollIds } } });
  created.expenseIds.length = 0; created.payrollIds.length = 0;
});
afterAll(async () => { await prisma.$disconnect(); });

describe("profitReport (T-2, FR-1/6, AC-1/8)", () => {
  it("revenue − (07 expenses + finalized staff cost) = profit; staff cost once", async () => {
    await seedMonth();
    const report = await profitReport(await claims(USER_MANAGER_ID), { propertyIds: [PROP_A_ID], from: FROM, to: TO });
    const b = report.breakdown;
    expect(b.revenuePaise).toBe(68_000_000);   // ₹6,80,000 (room + F&B)
    expect(b.staffCostPaise).toBe(15_000_000);  // ₹1,50,000 finalized payroll (full month)
    expect(b.expensePaise).toBe(36_000_000);    // ₹2,10,000 (07) + ₹1,50,000 (payroll) = ₹3,60,000
    expect(b.profitPaise).toBe(32_000_000);     // ₹3,20,000
    // Staff cost is NOT a 07 head (counted once, AC-8).
    expect(b.expenseByHead.STAFF).toBeUndefined();
  });

  it("apportions staff cost for a single-day view (AC-9)", async () => {
    await seedMonth();
    const day = new Date(`${YM}-05`);
    const oneDay = await profitReport(await claims(USER_MANAGER_ID), { propertyIds: [PROP_A_ID], from: day, to: day });
    // round(1,50,000 ÷ days-in-month) — computed via the real domain fn so it holds for any month length.
    expect(oneDay.breakdown.staffCostPaise).toBe(apportionStaffCost(15_000_000, DAYS_IN_MONTH, 1));
  });
});

describe("RBAC (T-6, AC-7)", () => {
  it("denies a role without report:view-financial (Housekeeping)", async () => {
    await expect(profitReport(await claims(USER_HOUSEKEEPING_ID), { propertyIds: [PROP_A_ID], from: FROM, to: TO }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
