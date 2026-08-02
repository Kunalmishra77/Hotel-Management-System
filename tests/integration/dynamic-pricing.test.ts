/**
 * 24 dynamic-pricing integration — T-5..T-8 (FR-1..6, AC-1/3/5/6/9/10).
 *   T-5 runPricingEngine → SUGGESTED (no auto-apply; 18 writes no DynamicRate)
 *   T-6 approveRate guardrail + approver + DynamicRateApproved event
 *   T-7 getResolvedRate fallback chain (negotiated → dynamic → plan → base)
 *   T-8 RBAC — pricing:approve required
 *   AC-9 concurrent approvals → exactly one APPROVED
 *
 * Auth mocked at the boundary (like reports.test): actions call `requireUser()`,
 * so the mock returns claims for the currently-selected fixture user. Engine and
 * query fns take `user` directly, so those use `assembleClaims`.
 *
 * Shared DB: every owned row uses a per-run-unique far-future date so the
 * `DynamicRate` unique (category, date) never collides across suite runs.
 */
import { vi, afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

// Actions resolve the caller via requireUser(); flip `h.userId` to act as a role.
const h = vi.hoisted(() => ({ userId: "user_manager", prisma: null as unknown as { $disconnect: () => Promise<void> } }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => {
    if (!h.prisma) {
      const { createPrismaClient } = await import("@/lib/db/client");
      h.prisma = createPrismaClient() as never;
    }
    const { assembleClaims } = await import("@/lib/auth/claims");
    const c = await assembleClaims(h.prisma as never, h.userId);
    if (!c) throw new Error(`no claims for ${h.userId}`);
    return c;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import {
  PROP_A_ID,
  CAT_DLX_ID,
  CAT_STE_ID,
  USER_MANAGER_ID,
  USER_RECEPTION_A_ID,
} from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { runPricingEngine } from "@/features/dynamic-pricing/engine";
import { approveRate, rejectRate } from "@/features/dynamic-pricing/actions";
import { getResolvedRate } from "@/features/dynamic-pricing/queries";

const prisma = createPrismaClient();

// Per-run-unique far-future dates: 20-day gap between runs, offsets within a run.
const SLOT = Math.floor(Date.now() / 60_000) % 30_000;
function dayAt(offset: number): Date {
  const d = new Date(Date.UTC(2100, 0, 1));
  d.setUTCDate(d.getUTCDate() + SLOT * 25 + offset);
  return d;
}

const created = { rateIds: [] as string[], planIds: [] as string[] };
let suiteBasePaise = 700_000;

async function claims(userId: string): Promise<SessionClaims> {
  const c = await assembleClaims(prisma, userId);
  if (!c) throw new Error("no claims");
  return c;
}

async function makeSuggested(roomCategoryId: string, date: Date, suggestedPaise: number): Promise<string> {
  const row = await prisma.dynamicRate.create({
    data: { propertyId: PROP_A_ID, roomCategoryId, date, suggestedPaise, status: "SUGGESTED" },
    select: { id: true },
  });
  created.rateIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  const suite = await prisma.roomCategory.findUnique({ where: { id: CAT_STE_ID }, select: { baseRatePaise: true } });
  if (suite) suiteBasePaise = suite.baseRatePaise;
});

afterAll(async () => {
  await prisma.dynamicRate.deleteMany({ where: { id: { in: created.rateIds } } });
  await prisma.ratePlan.deleteMany({ where: { id: { in: created.planIds } } });
  await prisma.$disconnect();
  if (h.prisma) await h.prisma.$disconnect();
});

describe("runPricingEngine → SUGGESTED (T-5, AC-1)", () => {
  it("upserts SUGGESTED rows, never auto-applies", async () => {
    const from = dayAt(0);
    const to = dayAt(1);
    const res = await runPricingEngine(await claims(USER_MANAGER_ID), {
      propertyId: PROP_A_ID,
      roomCategoryId: CAT_DLX_ID,
      from,
      to,
    });
    expect(res.categories).toBe(1);
    expect(res.suggested).toBeGreaterThanOrEqual(2);

    const rows = await prisma.dynamicRate.findMany({
      where: { roomCategoryId: CAT_DLX_ID, date: { gte: from, lte: to } },
      select: { id: true, status: true, suggestedPaise: true, appliedPaise: true },
    });
    created.rateIds.push(...rows.map((r) => r.id));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) {
      expect(r.status).toBe("SUGGESTED"); // no auto-apply (AC-1)
      expect(r.appliedPaise).toBeNull();
      expect(r.suggestedPaise).toBeGreaterThan(0);
    }
  });

  it("re-running never clobbers an APPROVED decision (AC-11)", async () => {
    const date = dayAt(2);
    const id = await makeSuggested(CAT_DLX_ID, date, 500_000);
    await prisma.dynamicRate.update({ where: { id }, data: { status: "APPROVED", appliedPaise: 500_000 } });

    await runPricingEngine(await claims(USER_MANAGER_ID), {
      propertyId: PROP_A_ID,
      roomCategoryId: CAT_DLX_ID,
      from: date,
      to: date,
    });
    const row = await prisma.dynamicRate.findUnique({ where: { id }, select: { status: true, appliedPaise: true } });
    expect(row?.status).toBe("APPROVED");
    expect(row?.appliedPaise).toBe(500_000);
  });
});

describe("approveRate (T-6, AC-3/7)", () => {
  it("approves within the guardrail: APPROVED, approver + appliedPaise recorded, event emitted", async () => {
    h.userId = USER_MANAGER_ID;
    const id = await makeSuggested(CAT_DLX_ID, dayAt(3), 690_000);
    const res = await approveRate({ dynamicRateId: id, appliedPaise: 650_000 });
    expect(res.ok).toBe(true);

    const row = await prisma.dynamicRate.findUnique({
      where: { id },
      select: { status: true, appliedPaise: true, approvedById: true },
    });
    expect(row).toMatchObject({ status: "APPROVED", appliedPaise: 650_000, approvedById: USER_MANAGER_ID });

    const events = await prisma.domainEvent.findMany({ where: { type: "DynamicRateApproved", aggregateId: id } });
    expect(events).toHaveLength(1);
  });

  it("rejects an out-of-band applied rate with RATE_OUT_OF_BOUNDS (AC-7)", async () => {
    h.userId = USER_MANAGER_ID;
    const id = await makeSuggested(CAT_DLX_ID, dayAt(4), 690_000);
    const res = await approveRate({ dynamicRateId: id, appliedPaise: 900_000 }); // > ₹8,000 ceil
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("RATE_OUT_OF_BOUNDS");

    const row = await prisma.dynamicRate.findUnique({ where: { id }, select: { status: true } });
    expect(row?.status).toBe("SUGGESTED"); // never published out of bounds
  });
});

describe("getResolvedRate fallback (T-7, AC-4/6/10)", () => {
  it("negotiated wins over an approved dynamic rate", async () => {
    const date = dayAt(5);
    const id = await makeSuggested(CAT_STE_ID, date, 720_000);
    await prisma.dynamicRate.update({ where: { id }, data: { status: "APPROVED", appliedPaise: 720_000 } });

    const r = await getResolvedRate(await claims(USER_MANAGER_ID), {
      propertyId: PROP_A_ID,
      roomCategoryId: CAT_STE_ID,
      date,
      negotiatedRatePaise: 500_000,
    });
    expect(r).toEqual({ ratePaise: 500_000, source: "NEGOTIATED" });
  });

  it("resolves an APPROVED dynamic rate when no negotiated rate is passed (AC-4)", async () => {
    const date = dayAt(6);
    const id = await makeSuggested(CAT_STE_ID, date, 730_000);
    await prisma.dynamicRate.update({ where: { id }, data: { status: "APPROVED", appliedPaise: 730_000 } });

    const r = await getResolvedRate(await claims(USER_MANAGER_ID), {
      propertyId: PROP_A_ID,
      roomCategoryId: CAT_STE_ID,
      date,
    });
    expect(r).toEqual({ ratePaise: 730_000, source: "DYNAMIC" });
  });

  it("a SUGGESTED (unapproved) rate is never used — falls through to base (AC-10)", async () => {
    const date = dayAt(7);
    await makeSuggested(CAT_STE_ID, date, 780_000); // stays SUGGESTED

    const r = await getResolvedRate(await claims(USER_MANAGER_ID), {
      propertyId: PROP_A_ID,
      roomCategoryId: CAT_STE_ID,
      date,
    });
    expect(r.source).toBe("BASE");
    expect(r.ratePaise).toBe(suiteBasePaise);
  });

  it("uses the rate plan when present and no approved dynamic rate exists", async () => {
    const date = dayAt(8);
    const plan = await prisma.ratePlan.create({
      data: { roomCategoryId: CAT_STE_ID, name: `test-${SLOT}`, ratePaise: 680_000 },
      select: { id: true },
    });
    created.planIds.push(plan.id);

    const r = await getResolvedRate(await claims(USER_MANAGER_ID), {
      propertyId: PROP_A_ID,
      roomCategoryId: CAT_STE_ID,
      date,
    });
    expect(r).toEqual({ ratePaise: 680_000, source: "PLAN" });
  });
});

describe("RBAC (T-8, AC-5)", () => {
  it("denies approve for a role without pricing:approve (Reception) → FORBIDDEN", async () => {
    h.userId = USER_RECEPTION_A_ID;
    const id = await makeSuggested(CAT_DLX_ID, dayAt(9), 500_000);
    const res = await approveRate({ dynamicRateId: id, appliedPaise: 500_000 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
    h.userId = USER_MANAGER_ID;
  });

  it("denies reject for a role without pricing:approve (Reception) → FORBIDDEN", async () => {
    h.userId = USER_RECEPTION_A_ID;
    const id = await makeSuggested(CAT_DLX_ID, dayAt(10), 500_000);
    const res = await rejectRate({ dynamicRateId: id, reason: "no" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
    h.userId = USER_MANAGER_ID;
  });
});

describe("concurrent approvals (AC-9)", () => {
  it("two managers approving the same rate → exactly one APPROVED", async () => {
    h.userId = USER_MANAGER_ID;
    const id = await makeSuggested(CAT_DLX_ID, dayAt(11), 600_000);

    const [a, b] = await Promise.all([
      approveRate({ dynamicRateId: id, appliedPaise: 600_000 }),
      approveRate({ dynamicRateId: id, appliedPaise: 650_000 }),
    ]);
    const oks = [a, b].filter((r) => r.ok).length;
    expect(oks).toBe(1); // exactly one publish

    const events = await prisma.domainEvent.findMany({ where: { type: "DynamicRateApproved", aggregateId: id } });
    expect(events).toHaveLength(1);

    const row = await prisma.dynamicRate.findUnique({ where: { id }, select: { status: true } });
    expect(row?.status).toBe("APPROVED");
  });
});
