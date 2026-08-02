/**
 * Traceability: 00 T-3 — FR-1/FR-2/FR-7, AC-1, AC-7, AC-10, AC-25.
 * Runs against the seeded fixtures (prisma/seed).
 */
import { createPrismaClient } from "@/lib/db/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  DEV_PASSWORD,
  ORG_ID,
  PROP_A_ID,
  PROP_B_ID,
  USER_ACCOUNTS_ID,
  USER_ADMIN_ID,
  USER_RECEPTION_A_ID,
} from "../../prisma/seed/fixtures";
import { verifyCredentials } from "@/lib/auth/credentials";
import { assembleClaims, findPiiInClaims, pickActiveProperty } from "@/lib/auth/claims";
import {
  createSession,
  resolveSession,
  revokeAllSessionsForUser,
  revokeSession,
  rotateSession,
  setActiveProperty,
} from "@/lib/auth/session";
import { hashSessionToken } from "@/lib/auth/session-token";
import { cleanupTempUsers, createTempUser } from "../helpers/temp-user";

// Same client configuration as production (transaction budget, logging),
// so tests exercise the real behaviour rather than Prisma defaults.
const prisma = createPrismaClient();
const NOW = new Date("2026-07-21T10:00:00.000Z");

afterEach(async () => {
  // Sessions and temp users are the only things these tests create. Seeded
  // fixtures are treated as read-only — anything needing mutation makes its own
  // user (see tests/helpers/temp-user.ts).
  await prisma.session.deleteMany({ where: { user: { orgId: ORG_ID } } });
  await cleanupTempUsers(prisma);
});

afterAll(async () => {
  await prisma.user.updateMany({
    where: { orgId: ORG_ID },
    data: { failedLoginCount: 0, lockedUntil: null },
  });
  await prisma.$disconnect();
});

describe("verifyCredentials (FR-1)", () => {
  it("accepts the correct password for U-REC-A", async () => {
    const r = await verifyCredentials(prisma, "reception.mg@woodpecker.example", DEV_PASSWORD, {
      now: NOW,
    });
    expect(r.kind).toBe("OK");
    if (r.kind === "OK") {
      expect(r.userId).toBe(USER_RECEPTION_A_ID);
      expect(r.requiresTotp).toBe(false);
    }
  });

  it("rejects a wrong password", async () => {
    const r = await verifyCredentials(prisma, "reception.mg@woodpecker.example", "nope", {
      now: NOW,
    });
    expect(r.kind).toBe("INVALID");
  });

  it("is indistinguishable to the caller for an unknown email vs a wrong password (AC-4)", async () => {
    const unknown = await verifyCredentials(prisma, "ghost@woodpecker.example", DEV_PASSWORD, {
      now: NOW,
    });
    const wrongPassword = await verifyCredentials(
      prisma,
      "reception.mg@woodpecker.example",
      "wrong",
      { now: NOW },
    );

    // The OUTCOME KIND is what reaches the client (the action maps every
    // rejection to one fixed message). It must not differ.
    expect(unknown.kind).toBe("INVALID");
    expect(wrongPassword.kind).toBe("INVALID");
  });

  it("attaches the user id ONLY when the email matched, so lockout can count (FR-4)", async () => {
    // These two cases must look identical from outside, but they cannot be
    // identical inside: FR-4 also requires failed attempts to accrue against a
    // real account. The id is used solely to increment that counter and is
    // never surfaced — the action returns the same message either way.
    const unknown = await verifyCredentials(prisma, "ghost@woodpecker.example", DEV_PASSWORD, {
      now: NOW,
    });
    const wrongPassword = await verifyCredentials(
      prisma,
      "reception.mg@woodpecker.example",
      "wrong",
      { now: NOW },
    );

    expect(unknown.kind === "INVALID" && unknown.userId).toBeUndefined();
    expect(wrongPassword.kind === "INVALID" && wrongPassword.userId).toBe(USER_RECEPTION_A_ID);
  });

  it("spends comparable time on an unknown email — no timing oracle (FR-4)", async () => {
    // A fast "no such user" path would leak account existence just as loudly as
    // a different message. verifyCredentials hashes against a dummy for misses.
    const t0 = Date.now();
    await verifyCredentials(prisma, "ghost@woodpecker.example", DEV_PASSWORD, { now: NOW });
    const unknownMs = Date.now() - t0;

    const t1 = Date.now();
    await verifyCredentials(prisma, "reception.mg@woodpecker.example", "wrong", { now: NOW });
    const wrongMs = Date.now() - t1;

    // Generous bound: this asserts the bcrypt work happens at all, not a precise
    // constant time (network jitter to a managed DB dominates otherwise).
    expect(unknownMs).toBeGreaterThan(50);
    expect(wrongMs).toBeGreaterThan(50);
  });

  it("is case- and whitespace-insensitive on the email", async () => {
    const r = await verifyCredentials(
      prisma,
      "  Reception.MG@Woodpecker.Example  ",
      DEV_PASSWORD,
      { now: NOW },
    );
    expect(r.kind).toBe("OK");
  });

  it("flags U-ACC as requiring TOTP (FR-3: enabled individually)", async () => {
    const r = await verifyCredentials(prisma, "accounts@woodpecker.example", DEV_PASSWORD, {
      now: NOW,
    });
    expect(r.kind).toBe("OK");
    if (r.kind === "OK") expect(r.requiresTotp).toBe(true);
  });

  it("flags U-ADMIN as requiring TOTP via enforced2faRoles (FR-5)", async () => {
    // U-ADMIN has totpEnabled=false, but ADMINISTRATOR is in enforced2faRoles.
    const r = await verifyCredentials(prisma, "admin@woodpecker.example", DEV_PASSWORD, {
      now: NOW,
    });
    expect(r.kind).toBe("OK");
    if (r.kind === "OK") expect(r.requiresTotp).toBe(true);
  });

  it("reports LOCKED while a lock is in force, without checking the password", async () => {
    const temp = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    const lockedUntil = new Date(NOW.getTime() + 15 * 60_000);
    await prisma.user.update({ where: { id: temp.id }, data: { lockedUntil } });

    const locked = await verifyCredentials(prisma, temp.email, temp.password, { now: NOW });
    expect(locked.kind).toBe("LOCKED");

    // …and the lock lapses on its own once the clock passes it — no unlock job.
    const after = await verifyCredentials(prisma, temp.email, temp.password, {
      now: new Date(lockedUntil.getTime() + 1000),
    });
    expect(after.kind).toBe("OK");
  });

  it("reports INACTIVE for a deactivated user who knows the password", async () => {
    const temp = await createTempUser(prisma, {
      role: "RECEPTION",
      propertyIds: [PROP_A_ID],
      isActive: false,
    });
    const r = await verifyCredentials(prisma, temp.email, temp.password, { now: NOW });
    expect(r.kind).toBe("INACTIVE");
  });
});

describe("assembleClaims (FR-2/FR-7/FR-10, AC-1/AC-7/AC-10)", () => {
  it("carries exactly the claim shape AC-1 specifies", async () => {
    const claims = await assembleClaims(prisma, USER_RECEPTION_A_ID);
    expect(claims).not.toBeNull();
    expect(Object.keys(claims!).sort()).toEqual(
      [
        "accessiblePropertyIds",
        "activePropertyId",
        "email",
        "name",
        "orgId",
        "propertyScope",
        "resolvedPermissions",
        "roleAssignments",
        "userId",
      ].sort(),
    );
  });

  it("contains NO guest PII (AC-7 / FR-7)", async () => {
    for (const id of [USER_RECEPTION_A_ID, USER_ACCOUNTS_ID, USER_ADMIN_ID]) {
      const claims = await assembleClaims(prisma, id);
      expect(findPiiInClaims(claims)).toEqual([]);
    }
  });

  it("never leaks the password hash, TOTP secret or backup codes", async () => {
    const claims = await assembleClaims(prisma, USER_ACCOUNTS_ID);
    const serialized = JSON.stringify(claims);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ACCOUNTS_ID } });
    expect(serialized).not.toContain(user.passwordHash);
    expect(serialized).not.toContain(user.totpSecret!);
    for (const code of user.backupCodes) expect(serialized).not.toContain(code);
  });

  it("scopes U-REC-A to PROP-A only (FR-8)", async () => {
    const claims = await assembleClaims(prisma, USER_RECEPTION_A_ID);
    expect(claims!.propertyScope).toEqual({ kind: "PROPERTIES", propertyIds: [PROP_A_ID] });
    expect(claims!.accessiblePropertyIds).toEqual([PROP_A_ID]);
  });

  it("gives U-ADMIN every property in the org (AC-10 / FR-10)", async () => {
    const claims = await assembleClaims(prisma, USER_ADMIN_ID);
    expect(claims!.propertyScope).toEqual({ kind: "ALL_IN_ORG" });

    // Compare against what the org ACTUALLY holds rather than a hardcoded
    // pair — the AC is "all properties in the org", so the assertion should
    // track the org, not a fixture snapshot that another suite can invalidate.
    const orgProperties = await prisma.property.findMany({
      where: { orgId: ORG_ID, isActive: true, deletedAt: null },
      select: { id: true },
    });
    expect([...claims!.accessiblePropertyIds].sort()).toEqual(
      orgProperties.map((p) => p.id).sort(),
    );
    expect(claims!.accessiblePropertyIds).toEqual(
      expect.arrayContaining([PROP_A_ID, PROP_B_ID]),
    );
  });

  it("gives U-ACC both assigned properties, enabling the switcher (AC-25)", async () => {
    const claims = await assembleClaims(prisma, USER_ACCOUNTS_ID);
    expect([...claims!.accessiblePropertyIds].sort()).toEqual([PROP_A_ID, PROP_B_ID].sort());
  });

  it("returns null for an unknown or deactivated user", async () => {
    expect(await assembleClaims(prisma, "does-not-exist")).toBeNull();

    const temp = await createTempUser(prisma, {
      role: "RECEPTION",
      propertyIds: [PROP_A_ID],
      isActive: false,
    });
    expect(await assembleClaims(prisma, temp.id)).toBeNull();
  });

  it("reflects a role change on the next assembly (FR-12 / AC-12)", async () => {
    const temp = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });

    const before = await assembleClaims(prisma, temp.id);
    expect(before!.resolvedPermissions).not.toContain("expense:approve");

    await prisma.roleAssignment.updateMany({
      where: { userId: temp.id },
      data: { role: "ACCOUNTS" },
    });

    // No re-login, no cache bust — the very next assembly sees it.
    const after = await assembleClaims(prisma, temp.id);
    expect(after!.resolvedPermissions).toContain("expense:approve");
  });

  it("applies a PermissionOverride that revokes a default grant (FR-11)", async () => {
    const temp = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    expect((await assembleClaims(prisma, temp.id))!.resolvedPermissions).toContain(
      "reservation:create",
    );

    await prisma.permissionOverride.create({
      data: { role: "RECEPTION", permission: "reservation:create", granted: false },
    });
    try {
      const after = await assembleClaims(prisma, temp.id);
      expect(after!.resolvedPermissions).not.toContain("reservation:create");
    } finally {
      await prisma.permissionOverride.deleteMany({
        where: { role: "RECEPTION", permission: "reservation:create" },
      });
    }
  });
});

describe("pickActiveProperty (FR-27)", () => {
  it("keeps a requested property that is still in scope", () => {
    expect(pickActiveProperty(PROP_B_ID, [PROP_A_ID, PROP_B_ID])).toBe(PROP_B_ID);
  });

  it("falls back when the requested property left scope", () => {
    expect(pickActiveProperty(PROP_B_ID, [PROP_A_ID])).toBe(PROP_A_ID);
  });

  it("is null when nothing is in scope", () => {
    expect(pickActiveProperty(null, [])).toBeNull();
  });
});

describe("session lifecycle (FR-2, security.md)", () => {
  it("issues a session, stamps lastLoginAt, and stores only the token hash (AC-1)", async () => {
    const created = await createSession(prisma, USER_RECEPTION_A_ID, { ip: "1.2.3.4" }, NOW);
    expect(created).not.toBeNull();

    const row = await prisma.session.findUniqueOrThrow({ where: { id: created!.sessionId } });
    expect(row.tokenHash).toBe(hashSessionToken(created!.token));
    expect(row.tokenHash).not.toBe(created!.token);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_RECEPTION_A_ID } });
    expect(user.lastLoginAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("sets the TTL from SecuritySettings.sessionTtlMinutes (FR-2/FR-7)", async () => {
    const settings = await prisma.securitySettings.findUniqueOrThrow({ where: { orgId: ORG_ID } });
    const created = await createSession(prisma, USER_RECEPTION_A_ID, {}, NOW);
    const expectedMs = settings.sessionTtlMinutes * 60_000;
    expect(created!.expiresAt.getTime() - NOW.getTime()).toBe(expectedMs);
  });

  it("resolves a valid token back to live claims", async () => {
    const created = await createSession(prisma, USER_RECEPTION_A_ID, {}, NOW);
    const resolved = await resolveSession(prisma, created!.token, NOW);
    expect(resolved?.claims.userId).toBe(USER_RECEPTION_A_ID);
  });

  it("refuses an expired session", async () => {
    const created = await createSession(prisma, USER_RECEPTION_A_ID, {}, NOW);
    const afterExpiry = new Date(created!.expiresAt.getTime() + 1000);
    expect(await resolveSession(prisma, created!.token, afterExpiry)).toBeNull();
  });

  it("refuses a revoked session immediately — force-logout (security.md)", async () => {
    const created = await createSession(prisma, USER_RECEPTION_A_ID, {}, NOW);
    expect(await resolveSession(prisma, created!.token, NOW)).not.toBeNull();

    await revokeSession(prisma, created!.token, NOW);
    // Same token, still inside its TTL, now rejected.
    expect(await resolveSession(prisma, created!.token, NOW)).toBeNull();
  });

  it("refuses an unknown or malformed token without throwing", async () => {
    expect(await resolveSession(prisma, "not-a-token", NOW)).toBeNull();
    expect(await resolveSession(prisma, "", NOW)).toBeNull();
    expect(await resolveSession(prisma, "A".repeat(43), NOW)).toBeNull();
  });

  it("stops resolving once the user is deactivated mid-session", async () => {
    const temp = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    const created = await createSession(prisma, temp.id, {}, NOW);
    expect(await resolveSession(prisma, created!.token, NOW)).not.toBeNull();

    await prisma.user.update({ where: { id: temp.id }, data: { isActive: false } });
    expect(await resolveSession(prisma, created!.token, NOW)).toBeNull();
  });

  it("rotates: new token works, old token is dead", async () => {
    const first = await createSession(prisma, USER_RECEPTION_A_ID, {}, NOW);
    const second = await rotateSession(prisma, first!.token, {}, NOW);

    expect(second).not.toBeNull();
    expect(second!.token).not.toBe(first!.token);
    expect(await resolveSession(prisma, second!.token, NOW)).not.toBeNull();
    expect(await resolveSession(prisma, first!.token, NOW)).toBeNull();
  });

  it("does not re-stamp lastLoginAt on rotation — rotation is not a login", async () => {
    // Otherwise "last login" creeps forward on every request and stops being
    // usable for audit or for spotting a dormant account.
    const first = await createSession(prisma, USER_RECEPTION_A_ID, {}, NOW);
    const afterLogin = await prisma.user.findUniqueOrThrow({
      where: { id: USER_RECEPTION_A_ID },
      select: { lastLoginAt: true },
    });

    const later = new Date(NOW.getTime() + 60_000);
    await rotateSession(prisma, first!.token, {}, later);

    const afterRotate = await prisma.user.findUniqueOrThrow({
      where: { id: USER_RECEPTION_A_ID },
      select: { lastLoginAt: true },
    });
    expect(afterRotate.lastLoginAt?.toISOString()).toBe(afterLogin.lastLoginAt?.toISOString());
  });

  it("revokes every session for a user (password reset / force-logout)", async () => {
    const a = await createSession(prisma, USER_RECEPTION_A_ID, {}, NOW);
    const b = await createSession(prisma, USER_RECEPTION_A_ID, {}, NOW);

    const count = await revokeAllSessionsForUser(prisma, USER_RECEPTION_A_ID, NOW);
    expect(count).toBe(2);
    expect(await resolveSession(prisma, a!.token, NOW)).toBeNull();
    expect(await resolveSession(prisma, b!.token, NOW)).toBeNull();
  });
});

describe("property switching (FR-27 / AC-25)", () => {
  it("switches U-ACC to PROP-B and persists it across resolution", async () => {
    const created = await createSession(prisma, USER_ACCOUNTS_ID, {}, NOW);
    const ok = await setActiveProperty(prisma, created!.sessionId, PROP_B_ID, created!.claims);
    expect(ok).toBe(true);

    const resolved = await resolveSession(prisma, created!.token, NOW);
    expect(resolved!.claims.activePropertyId).toBe(PROP_B_ID);
  });

  it("refuses to switch to a property outside scope (FR-9)", async () => {
    const created = await createSession(prisma, USER_RECEPTION_A_ID, {}, NOW);
    const ok = await setActiveProperty(prisma, created!.sessionId, PROP_B_ID, created!.claims);
    expect(ok).toBe(false);

    const resolved = await resolveSession(prisma, created!.token, NOW);
    expect(resolved!.claims.activePropertyId).toBe(PROP_A_ID);
  });

  it("falls back when the active property later leaves scope", async () => {
    const temp = await createTempUser(prisma, {
      role: "ACCOUNTS",
      propertyIds: [PROP_A_ID, PROP_B_ID],
    });
    const created = await createSession(prisma, temp.id, {}, NOW);
    await setActiveProperty(prisma, created!.sessionId, PROP_B_ID, created!.claims);

    // The user loses PROP-B while still signed in (design.md § Edge cases).
    await prisma.roleAssignment.updateMany({
      where: { userId: temp.id },
      data: { propertyIds: [PROP_A_ID] },
    });

    const resolved = await resolveSession(prisma, created!.token, NOW);
    expect(resolved!.claims.activePropertyId).toBe(PROP_A_ID);
    expect(resolved!.claims.accessiblePropertyIds).toEqual([PROP_A_ID]);
  });
});
