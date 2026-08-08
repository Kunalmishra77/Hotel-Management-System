/**
 * Traceability: 16 — integrations console. Covers the one write action
 * (setMessagingMode) + the consolidated read (getIntegrationsOverview) end-to-end
 * against the real DB (real authorize, real audit), mocking only `requireUser()`.
 *
 * The write targets a throwaway `test_`-prefixed provider so it never mutates the
 * seeded WhatsApp/SMS/EMAIL accounts; afterEach deletes those rows.
 */
import { vi } from "vitest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
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

import { USER_ADMIN_ID, USER_MANAGER_ID, USER_RECEPTION_A_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { setMessagingMode } from "@/features/integrations/actions";
import { getIntegrationsOverview } from "@/features/integrations/queries";

const prisma = createPrismaClient();
const TEST_PROVIDER = "test_msg_provider";

async function claimsFor(userId: string): Promise<SessionClaims> {
  const c = await assembleClaims(prisma, userId);
  if (!c) throw new Error(`no claims for ${userId}`);
  return c;
}

async function actAs(userId: string): Promise<SessionClaims> {
  const c = await claimsFor(userId);
  authMock.current = c;
  return c;
}

beforeEach(() => {
  authMock.current = null;
});

afterEach(async () => {
  await prisma.messagingAccount.deleteMany({ where: { provider: { startsWith: "test_" } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("setMessagingMode (Administrator)", () => {
  it("creates a channel row live + audits before/after with actor", async () => {
    await actAs(USER_ADMIN_ID);
    const res = await setMessagingMode({ channel: "SMS", provider: TEST_PROVIDER, mode: "live" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.mode).toBe("live");

    const row = await prisma.messagingAccount.findFirstOrThrow({
      where: { channel: "SMS", provider: TEST_PROVIDER },
    });
    expect(row.mode).toBe("live");

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "integration:set-messaging-mode", entityId: `${row.orgId}:SMS:${TEST_PROVIDER}` },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.userId).toBe(USER_ADMIN_ID);
    expect((audit.after as Record<string, unknown>).mode).toBe("live");
  });

  it("updates an existing row back to sandbox and records the prior mode", async () => {
    await actAs(USER_ADMIN_ID);
    await setMessagingMode({ channel: "SMS", provider: TEST_PROVIDER, mode: "live" });
    const res = await setMessagingMode({ channel: "SMS", provider: TEST_PROVIDER, mode: "sandbox" });
    expect(res.ok).toBe(true);

    const row = await prisma.messagingAccount.findFirstOrThrow({
      where: { channel: "SMS", provider: TEST_PROVIDER },
    });
    expect(row.mode).toBe("sandbox");
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "integration:set-messaging-mode", entityId: `${row.orgId}:SMS:${TEST_PROVIDER}` },
      orderBy: { createdAt: "desc" },
    });
    expect((audit.before as Record<string, unknown> | null)?.mode).toBe("live");
  });
});

describe("getIntegrationsOverview (Administrator)", () => {
  it("returns consolidated status across every domain", async () => {
    const admin = await claimsFor(USER_ADMIN_ID);
    const overview = await getIntegrationsOverview(admin);

    expect(overview.messaging.map((m) => m.channel).sort()).toEqual(["EMAIL", "SMS", "WHATSAPP"]);
    expect(overview.messaging.every((m) => m.blocker.length > 0)).toBe(true);
    expect(overview.payments.provider.length).toBeGreaterThan(0);
    expect(overview.payments.liveAdapterBuilt).toBe(false);
    expect(Array.isArray(overview.accounting)).toBe(true);
    expect(typeof overview.channels.total).toBe("number");
    expect(overview.ai.provider.length).toBeGreaterThan(0);
  });
});

describe("RBAC — integration:manage is Administrator-only", () => {
  it("denies a Manager", async () => {
    const manager = await actAs(USER_MANAGER_ID);
    const res = await setMessagingMode({ channel: "SMS", provider: TEST_PROVIDER, mode: "live" });
    expect(res.ok).toBe(false);
    await expect(getIntegrationsOverview(manager)).rejects.toThrow();
  });

  it("denies Reception", async () => {
    const reception = await actAs(USER_RECEPTION_A_ID);
    const res = await setMessagingMode({ channel: "SMS", provider: TEST_PROVIDER, mode: "live" });
    expect(res.ok).toBe(false);
    await expect(getIntegrationsOverview(reception)).rejects.toThrow();
  });
});
