/**
 * Traceability: 16 — org security-policy editor. Covers the write action + read
 * query end-to-end (real DB, real authorize/assertOrgWide, real audit + event),
 * mocking only the `requireUser()` auth boundary — same pattern as users.test.ts.
 *
 * SecuritySettings is a single org-keyed row shared by the fixture, so every
 * test restores it to the seed defaults in afterEach (isolation debt otherwise
 * leaks a changed auth policy into later suites).
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

import { RoleName } from "@prisma/client";
import { ORG_ID, USER_ADMIN_ID, USER_MANAGER_ID, USER_RECEPTION_A_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { updateSecuritySettings } from "@/features/settings/actions";
import { getOrgSecuritySettings } from "@/features/settings/queries";

const prisma = createPrismaClient();

const SEED_SECURITY = {
  passwordMinLength: 10,
  lockoutThreshold: 5,
  sessionTtlMinutes: 480,
  discountThresholdPaise: 100_000,
  enforced2faRoles: [] as RoleName[],
};

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
  await prisma.securitySettings.upsert({
    where: { orgId: ORG_ID },
    create: { orgId: ORG_ID, ...SEED_SECURITY },
    update: SEED_SECURITY,
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("updateSecuritySettings (Administrator, org-wide)", () => {
  it("persists all fields, emits SecuritySettingsChanged, audits with before/after + actor", async () => {
    await actAs(USER_ADMIN_ID);
    const res = await updateSecuritySettings({
      passwordMinLength: 12,
      lockoutThreshold: 7,
      sessionTtlMinutes: 720,
      discountThresholdPaise: 250_000,
      enforced2faRoles: ["ADMINISTRATOR"],
    });
    expect(res.ok).toBe(true);

    const row = await prisma.securitySettings.findUniqueOrThrow({ where: { orgId: ORG_ID } });
    expect(row.passwordMinLength).toBe(12);
    expect(row.lockoutThreshold).toBe(7);
    expect(row.sessionTtlMinutes).toBe(720);
    expect(row.discountThresholdPaise).toBe(250_000);
    expect(row.enforced2faRoles).toEqual(["ADMINISTRATOR"]);

    await prisma.domainEvent.findFirstOrThrow({ where: { type: "SecuritySettingsChanged", aggregateId: ORG_ID } });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "settings:security-update", entityId: ORG_ID },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.userId).toBe(USER_ADMIN_ID);
    expect((audit.after as Record<string, unknown>).lockoutThreshold).toBe(7);
  });

  it("is read back verbatim by getOrgSecuritySettings", async () => {
    const admin = await actAs(USER_ADMIN_ID);
    await updateSecuritySettings({
      passwordMinLength: 16,
      lockoutThreshold: 4,
      sessionTtlMinutes: 60,
      discountThresholdPaise: 500_000,
      enforced2faRoles: [],
    });
    const view = await getOrgSecuritySettings(admin);
    expect(view.passwordMinLength).toBe(16);
    expect(view.lockoutThreshold).toBe(4);
    expect(view.discountThresholdPaise).toBe(500_000);
  });
});

describe("org-wide gating", () => {
  it("denies a Manager (has settings:manage but only PROPERTIES scope)", async () => {
    const manager = await actAs(USER_MANAGER_ID);
    const res = await updateSecuritySettings({
      passwordMinLength: 8,
      lockoutThreshold: 3,
      sessionTtlMinutes: 15,
      discountThresholdPaise: 0,
      enforced2faRoles: [],
    });
    expect(res.ok).toBe(false);
    await expect(getOrgSecuritySettings(manager)).rejects.toThrow();
  });

  it("denies Reception (no settings:manage at all)", async () => {
    const reception = await actAs(USER_RECEPTION_A_ID);
    const res = await updateSecuritySettings({
      passwordMinLength: 8,
      lockoutThreshold: 3,
      sessionTtlMinutes: 15,
      discountThresholdPaise: 0,
      enforced2faRoles: [],
    });
    expect(res.ok).toBe(false);
    await expect(getOrgSecuritySettings(reception)).rejects.toThrow();
  });
});
