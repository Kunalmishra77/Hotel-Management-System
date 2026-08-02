/**
 * 25 corporate-crm integration — T-7..T-12 (FR-1..8, AC-1/2/5/6/7/8/9/10/12).
 * Auth mocked at the boundary; everything else real against the test DB.
 *
 * Corporate/agent/negotiated-rate rows are org-level master data (deletable), so
 * each is created with a per-run-unique id and torn down in afterAll — critical
 * because `receivablePaise` accumulates and the DB is shared with a concurrent
 * agent's suite.
 */
import { vi } from "vitest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

const authMock = vi.hoisted(() => ({ current: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => { if (!authMock.current) throw new Error("no user"); return authMock.current; } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { PROP_A_ID, GUEST_MEHTA_ID, CAT_DLX_ID, USER_MANAGER_ID, USER_RECEPTION_A_ID, USER_HOUSEKEEPING_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { createCorporate, createAgent, setNegotiatedRate } from "@/features/corporate/actions";
import { reserveCredit, releaseCredit } from "@/features/corporate";
import { getNegotiatedRate, corporateStatement, attributionReport, agentCommission } from "@/features/corporate/queries";
import { resolveRate } from "@/features/dynamic-pricing/domain/resolve";

const prisma = createPrismaClient();
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

const corpIds: string[] = [];
const agentIds: string[] = [];
const folioIds: string[] = [];
const reservationIds: string[] = [];

async function actAs(userId: string): Promise<SessionClaims> {
  const c = await assembleClaims(prisma, userId);
  if (!c) throw new Error("no claims");
  authMock.current = c;
  return c;
}

/** Create a corporate directly (unique id) with a preset limit/receivable. */
async function makeCorporate(opts: { limit: bigint; receivable?: bigint; suffix: string }): Promise<string> {
  const id = `corp_25_${RUN}_${opts.suffix}`;
  await prisma.corporate.create({
    data: { id, orgId: "org_woodpecker", name: `Test Corp ${opts.suffix}`, creditLimitPaise: opts.limit, receivablePaise: opts.receivable ?? 0n },
  });
  corpIds.push(id);
  return id;
}

/** An attributed reservation + folio with a ROOM line and (optional) CORPORATE_CREDIT payment. */
async function makeAttributedStay(opts: {
  suffix: string; corporateId?: string; travelAgentId?: string;
  roomRevenuePaise: bigint; creditPaymentPaise?: bigint; paymentReceivedAt?: Date; nights?: number;
}): Promise<{ folioId: string }> {
  const res = await prisma.reservation.create({
    data: {
      propertyId: PROP_A_ID, code: `R25-${RUN}-${opts.suffix}`, guestId: GUEST_MEHTA_ID,
      status: "CHECKED_OUT", source: opts.travelAgentId ? "TRAVEL_AGENT" : "CORPORATE",
      corporateId: opts.corporateId ?? null, travelAgentId: opts.travelAgentId ?? null,
      checkInDate: new Date("2099-01-10"), checkOutDate: new Date("2099-01-12"),
      nights: opts.nights ?? 2, ratePaise: 400_000,
    },
    select: { id: true },
  });
  reservationIds.push(res.id);
  const folio = await prisma.folio.create({ data: { propertyId: PROP_A_ID, kind: "RESERVATION", reservationId: res.id }, select: { id: true } });
  folioIds.push(folio.id);
  await prisma.folioLine.create({
    data: { folioId: folio.id, type: "ROOM", description: "Room", quantity: 1, unitPaise: 400_000, amountPaise: opts.roomRevenuePaise, businessDate: new Date("2099-01-10") },
  });
  if (opts.creditPaymentPaise) {
    await prisma.payment.create({
      data: { propertyId: PROP_A_ID, folioId: folio.id, mode: "CORPORATE_CREDIT", amountPaise: opts.creditPaymentPaise, isRefund: false, receivedAt: opts.paymentReceivedAt ?? new Date() },
    });
  }
  return { folioId: folio.id };
}

beforeEach(() => { authMock.current = null; });

afterAll(async () => {
  // Payment/FolioLine are append-only and Folio/Reservation (and the Corporate
  // they attribute to) are FK-restricted by them — all ids are per-run-unique
  // (RUN) so leftovers never collide. Only the cleanly-deletable rows are removed.
  await prisma.negotiatedRate.deleteMany({ where: { corporateId: { in: corpIds } } });
  await prisma.travelAgent.deleteMany({ where: { id: { in: agentIds } } });
  await prisma.$disconnect();
});

describe("createCorporate / createAgent (T-7, FR-1, AC-1)", () => {
  it("creates a corporate, emits CorporateCreated + audit (AC-1)", async () => {
    await actAs(USER_MANAGER_ID);
    const res = await createCorporate({ name: `NewCorp-${RUN}`, gstin: "29AAACA1234A1Z5", creditLimitPaise: 20_000_000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    corpIds.push(res.data.id);
    const row = await prisma.corporate.findUniqueOrThrow({ where: { id: res.data.id } });
    expect(row.creditLimitPaise).toBe(20_000_000n);
    expect(await prisma.domainEvent.findFirst({ where: { type: "CorporateCreated", aggregateId: res.data.id } })).not.toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { action: "corporate:create", entityId: res.data.id } })).not.toBeNull();
  });

  it("creates an agent with commission + AgentCreated (AC-1)", async () => {
    await actAs(USER_MANAGER_ID);
    const res = await createAgent({ name: `Sky-${RUN}`, commissionBps: 1000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    agentIds.push(res.data.id);
    expect((await prisma.travelAgent.findUniqueOrThrow({ where: { id: res.data.id } })).commissionBps).toBe(1000);
    expect(await prisma.domainEvent.findFirst({ where: { type: "AgentCreated", aggregateId: res.data.id } })).not.toBeNull();
  });

  it("denies a role without corporate:manage → FORBIDDEN (AC-12)", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const res = await createCorporate({ name: `Nope-${RUN}`, creditLimitPaise: 100 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });
});

describe("setNegotiatedRate / getNegotiatedRate (T-8, FR-4, AC-2/11)", () => {
  it("sets a rate, NegotiatedRateSet, and getNegotiatedRate resolves it — winning the 24 chain", async () => {
    await actAs(USER_MANAGER_ID);
    const corporateId = await makeCorporate({ limit: 20_000_000n, suffix: "neg" });
    const res = await setNegotiatedRate({ corporateId, roomCategoryId: CAT_DLX_ID, ratePaise: 350_000 });
    expect(res.ok).toBe(true);
    expect(await prisma.domainEvent.findFirst({ where: { type: "NegotiatedRateSet", aggregateId: corporateId } })).not.toBeNull();

    const rate = await getNegotiatedRate(corporateId, CAT_DLX_ID);
    expect(rate).toBe(350_000); // ₹3,500

    // 03/23 pass it into 24.resolveRate, where negotiated wins over base (AC-11).
    const resolved = resolveRate({ negotiatedRatePaise: rate, basePaise: 400_000 });
    expect(resolved).toEqual({ ratePaise: 350_000, source: "NEGOTIATED" });
  });

  it("returns null when no negotiated rate exists", async () => {
    const corporateId = await makeCorporate({ limit: 100n, suffix: "norate" });
    expect(await getNegotiatedRate(corporateId, CAT_DLX_ID)).toBeNull();
  });
});

describe("reserveCredit / releaseCredit — atomic under row lock (T-9, FR-3, AC-3/4/10)", () => {
  it("allows a settlement within the limit and increments the receivable (AC-3)", async () => {
    const id = await makeCorporate({ limit: 20_000_000n, receivable: 15_000_000n, suffix: "res" });
    const out = await prisma.$transaction((tx) => reserveCredit(tx, id, 4_000_000n));
    expect(out.receivablePaise).toBe(19_000_000n); // ₹1,90,000
    expect((await prisma.corporate.findUniqueOrThrow({ where: { id } })).receivablePaise).toBe(19_000_000n);
  });

  it("rejects over-limit with CREDIT_LIMIT_EXCEEDED and leaves the receivable unchanged (AC-4)", async () => {
    const id = await makeCorporate({ limit: 20_000_000n, receivable: 15_000_000n, suffix: "over" });
    await expect(prisma.$transaction((tx) => reserveCredit(tx, id, 6_000_000n))).rejects.toMatchObject({ code: "CREDIT_LIMIT_EXCEEDED" });
    expect((await prisma.corporate.findUniqueOrThrow({ where: { id } })).receivablePaise).toBe(15_000_000n);
  });

  it("releaseCredit decrements atomically and floors at zero (AC-10)", async () => {
    const id = await makeCorporate({ limit: 20_000_000n, receivable: 10_000_000n, suffix: "rel" });
    const out = await prisma.$transaction((tx) => releaseCredit(tx, id, 4_000_000n));
    expect(out.receivablePaise).toBe(6_000_000n);
    const floored = await prisma.$transaction((tx) => releaseCredit(tx, id, 99_000_000n));
    expect(floored.receivablePaise).toBe(0n); // never negative
  });

  it("serializes two concurrent near-limit settlements — one wins, no over-limit, no lost update (AC-9)", async () => {
    // limit ₹1,00,000; each settlement ₹60,000 → only one can fit.
    const id = await makeCorporate({ limit: 10_000_000n, receivable: 0n, suffix: "conc" });
    const results = await Promise.allSettled([
      prisma.$transaction((tx) => reserveCredit(tx, id, 6_000_000n)),
      prisma.$transaction((tx) => reserveCredit(tx, id, 6_000_000n)),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    // Exactly one increment landed — the receivable reflects a single winner.
    expect((await prisma.corporate.findUniqueOrThrow({ where: { id } })).receivablePaise).toBe(6_000_000n);
  });
});

describe("corporateStatement + aging (T-11, FR-2/7, AC-7)", () => {
  it("shows the cached receivable as balance with aged charges", async () => {
    const id = await makeCorporate({ limit: 20_000_000n, receivable: 5_000_000n, suffix: "stmt" });
    // Two CORPORATE_CREDIT settlements; balance ₹50,000 means ₹40,000 was later cleared.
    const old = new Date(Date.now() - 100 * 86_400_000); // 100 days ago → 90+
    await makeAttributedStay({ suffix: "stmt-a", corporateId: id, roomRevenuePaise: 4_000_000n, creditPaymentPaise: 4_000_000n, paymentReceivedAt: old });
    await makeAttributedStay({ suffix: "stmt-b", corporateId: id, roomRevenuePaise: 5_000_000n, creditPaymentPaise: 5_000_000n, paymentReceivedAt: new Date() });

    const user = await actAs(USER_MANAGER_ID);
    const stmt = await corporateStatement(user, { corporateId: id });
    expect(stmt).not.toBeNull();
    if (!stmt) return;
    expect(stmt.receivablePaise).toBe(5_000_000); // authoritative cached balance
    expect(stmt.charges).toHaveLength(2);
    expect(stmt.paidPaise).toBe(4_000_000); // Σ charges (₹90,000) − balance (₹50,000)
    // FIFO cleared the oldest (90+) charge; the recent one remains "current".
    expect(stmt.aging.days90plus).toBe(0);
    expect(stmt.aging.current).toBe(5_000_000);
    expect(stmt.aging.totalPaise).toBe(5_000_000);
  });

  it("denies statements to a role without report:view-financial (AC-8)", async () => {
    const id = await makeCorporate({ limit: 100n, suffix: "rbac" });
    const user = await actAs(USER_HOUSEKEEPING_ID);
    await expect(corporateStatement(user, { corporateId: id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("attributionReport + agentCommission (T-10, FR-5/6, AC-5/6)", () => {
  it("attributes revenue to corporate + agent and computes commission on room revenue", async () => {
    const corporateId = await makeCorporate({ limit: 20_000_000n, suffix: "attr" });
    const agent = await prisma.travelAgent.create({ data: { id: `agent_25_${RUN}`, orgId: "org_woodpecker", name: `TA-${RUN}`, commissionBps: 1000 }, select: { id: true } });
    agentIds.push(agent.id);
    await makeAttributedStay({ suffix: "attr-c", corporateId, roomRevenuePaise: 6_000_000n });
    await makeAttributedStay({ suffix: "attr-a", travelAgentId: agent.id, roomRevenuePaise: 10_000_000n });

    const user = await actAs(USER_MANAGER_ID);
    const range = { propertyIds: [PROP_A_ID], from: new Date("2099-01-01"), to: new Date("2099-01-31") };

    const attr = await attributionReport(user, range);
    expect(attr.corporates.find((c) => c.id === corporateId)?.revenuePaise).toBe(6_000_000);
    expect(attr.agents.find((a) => a.id === agent.id)?.revenuePaise).toBe(10_000_000);

    const comm = await agentCommission(user, range);
    const row = comm.find((r) => r.id === agent.id);
    expect(row?.roomRevenuePaise).toBe(10_000_000);
    expect(row?.commissionPayablePaise).toBe(1_000_000); // 10% of ₹1,00,000
  });

  it("denies attribution to a role without report:view-financial (AC-8)", async () => {
    const user = await actAs(USER_HOUSEKEEPING_ID);
    await expect(attributionReport(user, { propertyIds: [PROP_A_ID], from: new Date("2099-01-01"), to: new Date("2099-01-31") }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
