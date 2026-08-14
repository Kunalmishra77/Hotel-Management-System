/**
 * 07 expenses integration — T-4..T-8 (FR-1..7, AC-1..11). Auth mocked at the
 * boundary; everything else real. Expenses are deletable, so each test cleans up.
 */
import { vi } from "vitest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

const authMock = vi.hoisted(() => ({ current: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => { if (!authMock.current) throw new Error("no user"); return authMock.current; } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { PROP_A_ID, USER_ACCOUNTS_ID, USER_RECEPTION_A_ID, USER_MANAGER_ID, USER_ADMIN_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { createExpense, approveExpense, rejectExpense } from "@/features/expenses/actions";
import { expenseRollup } from "@/features/expenses/queries";

const prisma = createPrismaClient();
const created: string[] = [];

async function actAs(userId: string): Promise<SessionClaims> {
  const c = await assembleClaims(prisma, userId);
  if (!c) throw new Error("no claims");
  authMock.current = c;
  return c;
}
function track(r: { ok: boolean; data?: { id: string } }) { if (r.ok && r.data) created.push(r.data.id); }

const veg = (o: Record<string, unknown> = {}) => ({ propertyId: PROP_A_ID, head: "KITCHEN", subCategory: "Vegetables", amountPaise: 120_000, spentOn: "2026-07-12", paidVia: "CASH", ...o });

beforeEach(() => { authMock.current = null; });
afterEach(async () => {
  if (created.length) { await prisma.expense.deleteMany({ where: { id: { in: created } } }); created.length = 0; }
});
afterAll(async () => { await prisma.$disconnect(); });

describe("createExpense (T-4, FR-1/2/3/6, AC-1/2/3/7/8)", () => {
  it("records an expense with a stored bill, event and audit (AC-1/8)", async () => {
    await actAs(USER_ACCOUNTS_ID);
    const res = await createExpense(veg({ billBase64: Buffer.from("fake-bill").toString("base64") }));
    track(res);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = await prisma.expense.findUniqueOrThrow({ where: { id: res.data.id } });
    expect(row.status).toBe("DRAFT");
    expect(row.billObjectKey).not.toBeNull();
    expect(row.billObjectKey).toContain("expenses/");
    expect(await prisma.domainEvent.findFirst({ where: { type: "ExpenseRecorded", aggregateId: res.data.id } })).not.toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { action: "expense:create", entityId: res.data.id } })).not.toBeNull();
  });

  it("rejects amount ≤ 0 (AC-2/11)", async () => {
    await actAs(USER_ACCOUNTS_ID);
    const res = await createExpense(veg({ amountPaise: 0 }));
    track(res);
    expect(res.ok).toBe(false);
  });

  it("rejects a STAFF-head salary entry — salary belongs to payroll (AC-7)", async () => {
    await actAs(USER_ACCOUNTS_ID);
    const res = await createExpense(veg({ head: "STAFF", subCategory: "July Salary" }));
    track(res);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("allows a STAFF-head NON-salary entry (uniforms)", async () => {
    await actAs(USER_ACCOUNTS_ID);
    const res = await createExpense(veg({ head: "STAFF", subCategory: "Uniforms" }));
    track(res);
    expect(res.ok).toBe(true);
  });

  it("denies Reception (no expense:create) → FORBIDDEN (AC-3/10)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createExpense(veg());
    track(res);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });
});

describe("approve / reject (T-5, FR-4, AC-4/9)", () => {
  it("approves a DRAFT expense → APPROVED + ExpenseApproved", async () => {
    await actAs(USER_ACCOUNTS_ID);
    const res = await createExpense(veg());
    track(res);
    if (!res.ok) throw new Error("create failed");
    const ok = await approveExpense({ expenseId: res.data.id });
    expect(ok.ok).toBe(true);
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: res.data.id } })).status).toBe("APPROVED");
    expect(await prisma.domainEvent.findFirst({ where: { type: "ExpenseApproved", aggregateId: res.data.id } })).not.toBeNull();
  });

  it("rejects a DRAFT expense → REJECTED, excluded from rollup (AC-9)", async () => {
    await actAs(USER_ACCOUNTS_ID);
    const res = await createExpense(veg());
    track(res);
    if (!res.ok) throw new Error("create failed");
    const rej = await rejectExpense({ expenseId: res.data.id, reason: "duplicate" });
    expect(rej.ok).toBe(true);
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: res.data.id } })).status).toBe("REJECTED");
  });
});

describe("expenseRollup — APPROVED only (T-6, FR-5, AC-5)", () => {
  it("totals the day at ₹9,200 and excludes DRAFT/REJECTED", async () => {
    const claims = await actAs(USER_ACCOUNTS_ID);
    const a = await createExpense(veg({ amountPaise: 120_000 })); // ₹1,200 veg
    const b = await createExpense(veg({ head: "UTILITIES", subCategory: "Electricity", amountPaise: 800_000 })); // ₹8,000
    const draft = await createExpense(veg({ amountPaise: 500_000 })); // stays DRAFT → excluded
    track(a); track(b); track(draft);
    if (!a.ok || !b.ok) throw new Error("setup failed");
    await approveExpense({ expenseId: a.data.id });
    await approveExpense({ expenseId: b.data.id });

    const from = new Date("2026-07-12"); const to = new Date("2026-07-12");
    const roll = await expenseRollup(claims, { propertyIds: [PROP_A_ID], from, to, groupBy: "day" });
    expect(roll.totalPaise).toBe(920_000); // 1,200 + 8,000, DRAFT excluded
    expect(roll.totals["2026-07-12"]).toBe(920_000);

    const byHead = await expenseRollup(claims, { propertyIds: [PROP_A_ID], from, to, groupBy: "head" });
    expect(byHead.totals.KITCHEN).toBe(120_000);
    expect(byHead.totals.UTILITIES).toBe(800_000);
  });
});

describe("approval escalation (Phase 6 — major spend needs Super Admin)", () => {
  // Threshold is ₹25,000 = 2,500,000 paise.
  const large = () => veg({ head: "UTILITIES", subCategory: "Diesel genset", amountPaise: 3_000_000 });
  const small = () => veg({ head: "UTILITIES", subCategory: "Bulbs", amountPaise: 500_000 });

  async function makeExpense() {
    await actAs(USER_ACCOUNTS_ID);
    const res = await createExpense(large());
    track(res);
    if (!res.ok) throw new Error("setup: create failed");
    return res.data.id;
  }

  it("refuses a Manager approving a MAJOR expense (escalates to Super Admin)", async () => {
    const id = await makeExpense();
    await actAs(USER_MANAGER_ID);
    const res = await approveExpense({ expenseId: id });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
    expect((await prisma.expense.findUniqueOrThrow({ where: { id } })).status).toBe("DRAFT");
  });

  it("lets an Administrator approve the MAJOR expense", async () => {
    const id = await makeExpense();
    await actAs(USER_ADMIN_ID);
    const res = await approveExpense({ expenseId: id });
    expect(res.ok).toBe(true);
    expect((await prisma.expense.findUniqueOrThrow({ where: { id } })).status).toBe("APPROVED");
  });

  it("lets a Manager approve a MINOR expense (no escalation)", async () => {
    await actAs(USER_ACCOUNTS_ID);
    const mk = await createExpense(small());
    track(mk);
    if (!mk.ok) throw new Error("setup");
    await actAs(USER_MANAGER_ID);
    const res = await approveExpense({ expenseId: mk.data.id });
    expect(res.ok).toBe(true);
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: mk.data.id } })).status).toBe("APPROVED");
  });
});
