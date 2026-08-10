/**
 * Traceability: 00-platform T-2 — seed fixtures.
 *
 * Every spec's `Test Fixtures` table promises these rows exist with these
 * properties. Downstream module tests are written against them, so a silent
 * change to the seed would break tests far away from the cause. This asserts
 * the contract at its source.
 */
import { RoleName } from "@prisma/client";
import { createPrismaClient } from "@/lib/db/client";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEV_PASSWORD,
  ORG_ID,
  PROP_A_ID,
  PROP_B_ID,
  USER_ACCOUNTS_BACKUP_CODES,
  USER_ACCOUNTS_ID,
  USER_ACCOUNTS_TOTP_SECRET,
  USER_ADMIN_ID,
  USER_RECEPTION_A_ID,
} from "../../prisma/seed/fixtures";
import { verifyPassword } from "@/lib/auth/password";
import { consumeBackupCode, hashBackupCode, verifyTotp } from "@/lib/auth/totp";
import { decryptString, isEncrypted } from "@/lib/crypto/encryption";
import { resolvePermissions, resolvePropertyScope } from "@/lib/permissions";

// Same client configuration as production (transaction budget, logging),
// so tests exercise the real behaviour rather than Prisma defaults.
const prisma = createPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("ORG / properties", () => {
  it("seeds the Woodpecker Group organisation", async () => {
    const org = await prisma.organization.findUnique({ where: { id: ORG_ID } });
    expect(org?.name).toBe("Woodpecker Group");
  });

  it("seeds PROP-A (WMG) and PROP-B (WWF) in that org", async () => {
    const props = await prisma.property.findMany({
      where: { orgId: ORG_ID },
      orderBy: { code: "asc" },
    });
    // Containment, not equality: the assertion is that the FIXTURES exist.
    // Demanding they be the only two made this fail whenever another suite
    // legitimately created a property.
    expect(props.map((p) => p.code)).toEqual(expect.arrayContaining(["WMG", "WWF"]));
    expect(props.map((p) => p.id)).toEqual(expect.arrayContaining([PROP_A_ID, PROP_B_ID]));
  });

  it("stores property-local timezone so business dates can be interpreted", () => {
    // data-model.md: local calendar dates need Property.timezone to mean anything.
    return prisma.property.findMany({ where: { orgId: ORG_ID } }).then((props) => {
      for (const p of props) expect(p.timezone).toBe("Asia/Kolkata");
    });
  });
});

describe("SecuritySettings (FR-1/4/5/7 source their limits here, not constants)", () => {
  it("exists for the org with the documented defaults", async () => {
    const s = await prisma.securitySettings.findUnique({ where: { orgId: ORG_ID } });
    expect(s).not.toBeNull();
    expect(s!.lockoutThreshold).toBe(5); // AC-4 default
    expect(s!.passwordMinLength).toBeGreaterThanOrEqual(10);
    expect(s!.sessionTtlMinutes).toBeGreaterThan(0);
  });

  it("does not org-mandate 2FA (relaxed for the demo; still available per user)", async () => {
    // The client turned enforcement off so admin/accounts sign in without a TOTP
    // code. 2FA remains AVAILABLE per user (see the U-ACC TOTP fixtures below);
    // only org-wide enforcement is empty. Flip enforced2faRoles in the 00 seed to
    // re-mandate it.
    const s = await prisma.securitySettings.findUnique({ where: { orgId: ORG_ID } });
    expect(s!.enforced2faRoles).toHaveLength(0);
  });
});

describe("U-ADMIN — org-wide scope (AC-10 / FR-10)", () => {
  it("has an ADMINISTRATOR assignment with empty propertyIds", async () => {
    const ras = await prisma.roleAssignment.findMany({ where: { userId: USER_ADMIN_ID } });
    expect(ras).toHaveLength(1);
    expect(ras[0]!.role).toBe(RoleName.ADMINISTRATOR);
    expect(ras[0]!.propertyIds).toEqual([]);
  });

  it("resolves to ALL_IN_ORG scope and every permission", async () => {
    const ras = await prisma.roleAssignment.findMany({ where: { userId: USER_ADMIN_ID } });
    const claims = ras.map((r) => ({ role: r.role, propertyIds: r.propertyIds }));

    expect(resolvePropertyScope(claims)).toEqual({ kind: "ALL_IN_ORG" });
    const perms = resolvePermissions(claims);
    expect(perms).toContain("user:manage");
    expect(perms).toContain("folio:refund");
  });
});

describe("U-REC-A — RECEPTION @ PROP-A, 2FA disabled (AC-1)", () => {
  it("is scoped to PROP-A only", async () => {
    const ras = await prisma.roleAssignment.findMany({ where: { userId: USER_RECEPTION_A_ID } });
    expect(ras[0]!.role).toBe(RoleName.RECEPTION);
    expect(ras[0]!.propertyIds).toEqual([PROP_A_ID]);
    expect(resolvePropertyScope([{ role: ras[0]!.role, propertyIds: ras[0]!.propertyIds }])).toEqual(
      { kind: "PROPERTIES", propertyIds: [PROP_A_ID] },
    );
  });

  it("has 2FA disabled and no backup codes", async () => {
    const u = await prisma.user.findUnique({ where: { id: USER_RECEPTION_A_ID } });
    expect(u!.totpEnabled).toBe(false);
    expect(u!.totpSecret).toBeNull();
    expect(u!.backupCodes).toEqual([]);
  });

  it("stores the password only as a bcrypt hash that verifies (AC-1)", async () => {
    const u = await prisma.user.findUnique({ where: { id: USER_RECEPTION_A_ID } });
    expect(u!.passwordHash).not.toContain(DEV_PASSWORD);
    expect(u!.passwordHash.startsWith("$2")).toBe(true);
    await expect(verifyPassword(DEV_PASSWORD, u!.passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", u!.passwordHash)).resolves.toBe(false);
  });

  it("cannot approve expenses — deny-by-default (AC-11)", async () => {
    const ras = await prisma.roleAssignment.findMany({ where: { userId: USER_RECEPTION_A_ID } });
    const perms = resolvePermissions(ras.map((r) => ({ role: r.role, propertyIds: r.propertyIds })));
    expect(perms).not.toContain("expense:approve");
    expect(perms).toContain("reservation:create");
  });

  it("starts unlocked, so a re-seed clears any prior lockout test", async () => {
    const u = await prisma.user.findUnique({ where: { id: USER_RECEPTION_A_ID } });
    expect(u!.failedLoginCount).toBe(0);
    expect(u!.lockedUntil).toBeNull();
  });
});

describe("U-ACC — ACCOUNTS @ PROP-A+B, 2FA enabled (AC-2/3, AC-25)", () => {
  it("is scoped to both properties, enabling the property switcher", async () => {
    const ras = await prisma.roleAssignment.findMany({ where: { userId: USER_ACCOUNTS_ID } });
    expect(ras[0]!.role).toBe(RoleName.ACCOUNTS);
    expect([...ras[0]!.propertyIds].sort()).toEqual([PROP_A_ID, PROP_B_ID].sort());
  });

  it("stores the TOTP secret encrypted at rest, never in plaintext (FR-5)", async () => {
    const u = await prisma.user.findUnique({ where: { id: USER_ACCOUNTS_ID } });
    expect(u!.totpEnabled).toBe(true);
    expect(u!.totpSecret).not.toBeNull();
    expect(isEncrypted(u!.totpSecret)).toBe(true);
    expect(u!.totpSecret).not.toContain(USER_ACCOUNTS_TOTP_SECRET);
    expect(decryptString(u!.totpSecret!)).toBe(USER_ACCOUNTS_TOTP_SECRET);
  });

  it("the decrypted secret generates codes that verify (AC-2)", async () => {
    const u = await prisma.user.findUnique({ where: { id: USER_ACCOUNTS_ID } });
    const secret = decryptString(u!.totpSecret!);
    const { authenticator } = await import("otplib");
    const at = new Date("2026-07-21T10:00:00.000Z");
    authenticator.options = { epoch: at.getTime(), step: 30 };
    const token = authenticator.generate(secret);
    authenticator.resetOptions();

    expect(verifyTotp(secret, token, at)).toBe(true);
    expect(verifyTotp(secret, "000000", at)).toBe(false);
  });

  it("stores backup codes hashed, never as plaintext (FR-5)", async () => {
    const u = await prisma.user.findUnique({ where: { id: USER_ACCOUNTS_ID } });
    expect(u!.backupCodes).toHaveLength(USER_ACCOUNTS_BACKUP_CODES.length);
    for (const plain of USER_ACCOUNTS_BACKUP_CODES) {
      expect(u!.backupCodes).not.toContain(plain);
      expect(u!.backupCodes).toContain(hashBackupCode(plain));
    }
  });

  it("a seeded backup code matches and is consumable exactly once (AC-3)", async () => {
    const u = await prisma.user.findUnique({ where: { id: USER_ACCOUNTS_ID } });
    const first = consumeBackupCode(USER_ACCOUNTS_BACKUP_CODES[0], u!.backupCodes);
    expect(first.consumed).toBe(true);

    const reuse = consumeBackupCode(USER_ACCOUNTS_BACKUP_CODES[0], first.remainingHashes);
    expect(reuse.consumed).toBe(false);
  });

  it("holds financial permissions Reception does not", async () => {
    const ras = await prisma.roleAssignment.findMany({ where: { userId: USER_ACCOUNTS_ID } });
    const perms = resolvePermissions(ras.map((r) => ({ role: r.role, propertyIds: r.propertyIds })));
    expect(perms).toContain("expense:approve");
    expect(perms).toContain("report:view-financial");
    // …but is still not an administrator.
    expect(perms).not.toContain("user:manage");
  });
});

describe("seed determinism", () => {
  it("has exactly one role assignment per fixture user (re-runs must not stack)", async () => {
    const grouped = await prisma.roleAssignment.groupBy({
      by: ["userId"],
      _count: { _all: true },
    });
    for (const g of grouped) expect(g._count._all).toBe(1);
  });

  it("seeds users covering the core roles + both owners for RBAC coverage", async () => {
    // 6 core-ops roles (admin/manager/reception/accounts/housekeeping/maintenance)
    // + 2 property owners (27 owner-portal) = 8 users across 7 distinct roles.
    const users = await prisma.user.findMany({ where: { orgId: ORG_ID } });
    expect(users).toHaveLength(8);
    const roles = await prisma.roleAssignment.findMany();
    expect(new Set(roles.map((r) => r.role)).size).toBe(7);
  });
});
