/**
 * 18 AI features — integration (FR-2..10, AC-3/4/5/6/9/10/11/12). Everything runs
 * on the deterministic `mock` provider. Auth is mocked at the boundary; 12's
 * `recordSentiment` is stubbed (module 12 is built concurrently — 18 only calls
 * its contract). Dedicated rows are seeded so other suites can't perturb this.
 */
import { vi } from "vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

vi.mock("@/lib/auth", () => ({ requireUser: async () => { throw new Error("unused"); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
// Module 12 (communications) owns Feedback + recordSentiment; stub its contract.
vi.mock("@/features/communications/actions", () => ({ recordSentiment: vi.fn(async () => ({ ok: true })) }));

import {
  ORG_ID,
  PROP_A_ID,
  CAT_DLX_ID,
  USER_MANAGER_ID,
  USER_HOUSEKEEPING_ID,
  USER_RECEPTION_A_ID,
  GUEST_RAVI_ID,
} from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { encryptString } from "@/lib/crypto/encryption";
import { mobileToken } from "@/features/guests/internal";
import { recordSentiment } from "@/features/communications/actions";
import { resetProviderCache } from "@/lib/ai";
import { nlSearch } from "@/features/ai/nl-search";
import { chat } from "@/features/ai/chat";
import { forecast } from "@/features/ai/forecast";
import { suggestRates } from "@/features/ai/pricing";
import { updateSegments } from "@/features/ai/segments";
import { recordFeedbackSentiment } from "@/features/ai/sentiment";
import { withAiContext } from "@/features/ai/internal";
import { ALLOWED_TOOL_NAMES, executeTool } from "@/features/ai/tools";

const prisma = createPrismaClient();
const BLR_GUEST = "ai_guest_blr";
const CORP_GUEST = "ai_guest_corp";
const FB_NEG = "ai_fb_neg";
const MOBILE = "9812345678";
const testStart = new Date();

async function claims(userId: string): Promise<SessionClaims> {
  const c = await assembleClaims(prisma, userId);
  if (!c) throw new Error("no claims");
  return c;
}

beforeAll(async () => {
  process.env.AI_PROVIDER = "mock";
  resetProviderCache();

  await prisma.guest.upsert({
    where: { id: BLR_GUEST },
    create: { id: BLR_GUEST, orgId: ORG_ID, fullName: "Bangalore Repeat", mobile: encryptString(MOBILE), mobileHash: mobileToken(MOBILE), city: "Bangalore", state: "Karnataka" },
    update: { deletedAt: null, city: "Bangalore" },
  });
  await prisma.guest.upsert({
    where: { id: CORP_GUEST },
    create: { id: CORP_GUEST, orgId: ORG_ID, fullName: "Corp Guest", mobile: encryptString("9812345679"), mobileHash: mobileToken("9812345679"), city: "Pune", companyName: "AICORP-18" },
    update: { deletedAt: null, companyName: "AICORP-18" },
  });
  await prisma.feedback.upsert({
    where: { id: FB_NEG },
    create: { id: FB_NEG, propertyId: PROP_A_ID, guestId: GUEST_RAVI_ID, comment: "AC never worked, terrible stay", source: "post-checkout" },
    update: { comment: "AC never worked, terrible stay", sentiment: null },
  });
});

afterAll(async () => {
  await prisma.guestSegment.deleteMany({ where: { orgId: ORG_ID } });
  await prisma.feedback.deleteMany({ where: { id: FB_NEG } });
  await prisma.guest.deleteMany({ where: { id: { in: [BLR_GUEST, CORP_GUEST] } } });
  await prisma.aiInteractionLog.deleteMany({ where: { createdAt: { gte: testStart } } });
  await prisma.$disconnect();
});

describe("NL search — no raw SQL (AC-4/5)", () => {
  it("compiles NL → 15 StructuredQuery, runs scoped + masked (AC-4)", async () => {
    const user = await claims(USER_MANAGER_ID);
    const { query, results } = await nlSearch(user, {
      text: "guests from Bangalore who stayed more than 2 times in the last 2 years",
    });
    expect(query.entity).toBe("guest");
    expect(query.filters.some((f) => f.field === "city")).toBe(true);
    const hit = results.find((r) => r.id === BLR_GUEST);
    expect(hit).toBeDefined();
    expect(hit!.fields.mobile).not.toBe(MOBILE); // masked (FR-3)
  });

  it("rejects a compiled non-whitelisted field and never executes it (AC-5)", async () => {
    const user = await claims(USER_MANAGER_ID);
    await expect(
      nlSearch(user, { text: "find guests where passwordHash = secret" }),
    ).rejects.toMatchObject({ code: "INVALID_QUERY" });
  });
});

describe("RBAC — ai:use required (AC-12)", () => {
  it("denies a user without ai:use (housekeeping)", async () => {
    const user = await claims(USER_HOUSEKEEPING_ID);
    await expect(nlSearch(user, { text: "guests from Bangalore" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("Chatbot — read-only, staff-only (AC-3/10)", () => {
  it("exposes NO mutation tools", () => {
    const mutating = [...ALLOWED_TOOL_NAMES].filter((n) => /create|update|delete|void|refund|charge|cancel|checkin|checkout/i.test(n));
    expect(mutating).toEqual([]);
  });

  it("refuses to execute a tool that is not on the read-only allow-list (AC-10)", async () => {
    const user = await claims(USER_MANAGER_ID);
    await expect(executeTool(user, "create_reservation", {})).rejects.toThrow();
  });

  it("answers an availability question using a read-only tool", async () => {
    const user = await claims(USER_MANAGER_ID);
    const res = await chat(user, { message: "any rooms available this weekend?" });
    expect(res.usedTools).toContain("search_availability");
    expect(res.answer.length).toBeGreaterThan(0);
  });
});

describe("Sentiment — classify + write back via 12 (AC-6)", () => {
  it("classifies NEGATIVE, calls 12.recordSentiment, emits SentimentClassified", async () => {
    const user = await claims(USER_MANAGER_ID);
    const out = await withAiContext(user, () =>
      recordFeedbackSentiment({ feedbackId: FB_NEG, text: "AC never worked, terrible stay", propertyId: PROP_A_ID, userId: user.userId }),
    );
    expect(out.label).toBe("NEGATIVE");
    expect(vi.mocked(recordSentiment)).toHaveBeenCalledWith(
      expect.objectContaining({ feedbackId: FB_NEG, label: "NEGATIVE" }),
    );
    const event = await prisma.domainEvent.findFirst({ where: { type: "SentimentClassified", aggregateId: FB_NEG } });
    expect(event).not.toBeNull();
    // 18 never writes Feedback directly — the row's sentiment stays null (12 owns the write, stubbed here).
    const fb = await prisma.feedback.findUnique({ where: { id: FB_NEG }, select: { sentiment: true } });
    expect(fb?.sentiment).toBeNull();
  });
});

describe("Segmentation (AC-9)", () => {
  it("computes advisory GuestSegment rows and emits SegmentUpdated", async () => {
    const user = await claims(USER_MANAGER_ID);
    const summaries = await updateSegments(user);
    expect(summaries.length).toBeGreaterThan(0);
    const blr = await prisma.guestSegment.findFirst({ where: { orgId: ORG_ID, name: "Bangalore Guests" } });
    expect(blr?.guestIds).toContain(BLR_GUEST);
    const event = await prisma.domainEvent.findFirst({ where: { type: "SegmentUpdated" } });
    expect(event).not.toBeNull();
  });

  it("adds deterministic look-alike groups from embeddings and prunes on rerun (FR-8)", async () => {
    const user = await claims(USER_MANAGER_ID);
    // The seed + test guests are well over the clustering threshold, so the mock
    // provider's stable embeddings must produce at least one look-alike group.
    await updateSegments(user);
    const lookalike = await prisma.guestSegment.findMany({
      where: { orgId: ORG_ID, name: { startsWith: "Look-alike Group " } },
      orderBy: { name: "asc" },
    });
    expect(lookalike.length).toBeGreaterThan(0);
    expect(lookalike[0]!.guestIds.length).toBeGreaterThan(0);
    // Every look-alike segment carries its cluster rule (traceable WHY).
    expect(lookalike.every((s) => (s.ruleJson as { kind?: string } | null)?.kind === "lookalike")).toBe(true);

    // Deterministic: a second run yields the SAME group names + membership.
    const before = lookalike.map((s) => ({ name: s.name, ids: [...s.guestIds].sort() }));
    await updateSegments(user);
    const after = await prisma.guestSegment.findMany({
      where: { orgId: ORG_ID, name: { startsWith: "Look-alike Group " } },
      orderBy: { name: "asc" },
    });
    expect(after.map((s) => ({ name: s.name, ids: [...s.guestIds].sort() }))).toEqual(before);
  });
});

describe("Rate suggestions — 18 suggests, never writes DynamicRate (AC-8)", () => {
  it("returns grounded suggestions and emits RateSuggested; writes no DynamicRate", async () => {
    const user = await claims(USER_MANAGER_ID);
    const from = new Date("2027-03-01T00:00:00.000Z");
    const to = new Date("2027-03-03T00:00:00.000Z");
    const suggestions = await suggestRates(user, { propertyId: PROP_A_ID, categoryId: CAT_DLX_ID, from, to });
    expect(suggestions.length).toBe(3);
    expect(suggestions.every((s) => s.suggestedPaise > 0)).toBe(true);

    const event = await prisma.domainEvent.findFirst({ where: { type: "RateSuggested", aggregateId: CAT_DLX_ID } });
    expect(event).not.toBeNull();

    // 18 writes NO DynamicRate — that is 24's job.
    const dr = await prisma.dynamicRate.count({ where: { roomCategoryId: CAT_DLX_ID, date: { gte: from, lte: to } } });
    expect(dr).toBe(0);
  });
});

describe("Forecast — grounded numbers, LLM phrases (AC-7)", () => {
  it("returns a narrative alongside grounded figures", async () => {
    const user = await claims(USER_MANAGER_ID);
    const res = await forecast(user, { propertyId: PROP_A_ID, metric: "revenue", horizonDays: 7 });
    expect(res.metric).toBe("revenue");
    expect(typeof res.narrative).toBe("string");
    expect(res.forecast).toHaveLength(7);
  });

  it("forecasts expense and profit off the same snapshots (FR-6)", async () => {
    const user = await claims(USER_MANAGER_ID);
    const expense = await forecast(user, { propertyId: PROP_A_ID, metric: "expense", horizonDays: 7 });
    expect(expense.metric).toBe("expense");
    expect(expense.forecast).toHaveLength(7);
    expect(expense.forecast.every((p) => p.value >= 0)).toBe(true);

    const profit = await forecast(user, { propertyId: PROP_A_ID, metric: "profit", horizonDays: 7 });
    expect(profit.metric).toBe("profit");
    expect(profit.forecast).toHaveLength(7);
    expect(typeof profit.narrative).toBe("string");
  });

  it("gates financial metrics on report:view-financial — reception (ai:use) is denied profit (AC-12)", async () => {
    // Reception HAS ai:use but NOT report:view-financial, so it passes the first
    // gate and is stopped by the money-path gate specifically.
    const user = await claims(USER_RECEPTION_A_ID);
    await expect(forecast(user, { propertyId: PROP_A_ID, metric: "profit", horizonDays: 7 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(forecast(user, { propertyId: PROP_A_ID, metric: "expense", horizonDays: 7 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // But occupancy (operational) is allowed for reception.
    const occ = await forecast(user, { propertyId: PROP_A_ID, metric: "occupancy", horizonDays: 3 });
    expect(occ.metric).toBe("occupancy");
  });
});

describe("PII minimization in AiInteractionLog (AC-11)", () => {
  it("stores a redacted input and the provider name, never raw PII", async () => {
    const user = await claims(USER_MANAGER_ID);
    await nlSearch(user, { text: "guests from Bangalore phone 9876543210" });
    const log = await prisma.aiInteractionLog.findFirst({
      where: { feature: "nl-search" },
      orderBy: { createdAt: "desc" },
    });
    expect(log).not.toBeNull();
    expect(log!.provider).toBe("mock");
    expect(JSON.stringify(log!.inputRedacted)).not.toContain("9876543210");
  });
});
