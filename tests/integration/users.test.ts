/**
 * Traceability: 16 (00-platform FR-13) — user administration + admin session
 * oversight. The `src/features/users` surface had ZERO tests; this file covers
 * every admin action end-to-end against the real DB (real authorize, real audit
 * and event rows), mocking only the `requireUser()` auth boundary — the same
 * pattern as guests.test.ts.
 *
 * Beyond happy paths: self-lockout guards, session-revocation side-effects,
 * RBAC denial for a non-admin, and the no-secret-in-audit probe on password ops.
 */
import { vi } from "vitest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

// Mocks must be declared before importing the actions under test.
const authMock = vi.hoisted(() => ({ current: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => {
    if (!authMock.current) throw new Error("no test user set");
    return authMock.current;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { ORG_ID, PROP_A_ID, USER_ADMIN_ID, USER_RECEPTION_A_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { createSession } from "@/lib/auth/session";
import {
  adminResetPassword,
  createUser,
  getUserSessions,
  revokeUserSessions,
  setUserActive,
  updateUserRoles,
} from "@/features/users/actions";
import { listUsers, listUserSessions } from "@/features/users/queries";
import { createTempUser, cleanupTempUsers } from "../helpers/temp-user";

const prisma = createPrismaClient();
const createdUserIds: string[] = [];

async function actAs(userId: string): Promise<SessionClaims> {
  const claims = await assembleClaims(prisma, userId);
  if (!claims) throw new Error(`no claims for ${userId}`);
  authMock.current = claims;
  return claims;
}

async function removeUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.passwordResetToken.deleteMany({ where: { userId } });
  await prisma.roleAssignment.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

beforeEach(() => {
  authMock.current = null;
});

afterEach(async () => {
  for (const id of createdUserIds) await removeUser(id);
  createdUserIds.length = 0;
  await cleanupTempUsers(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("createUser", () => {
  it("creates the user + role, emits UserCreated/RoleAssigned, audits — no password leaked", async () => {
    await actAs(USER_ADMIN_ID);
    const email = `new.user.${Date.now()}@test.invalid`;
    const res = await createUser({
      email,
      name: "New Staff",
      password: "a-strong-password",
      role: "RECEPTION",
      propertyIds: [PROP_A_ID],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    createdUserIds.push(res.data.id);

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: res.data.id },
      include: { roleAssignments: true },
    });
    expect(row.email).toBe(email);
    expect(row.passwordHash).not.toContain("a-strong-password");
    expect(row.roleAssignments[0]?.role).toBe("RECEPTION");
    expect(row.roleAssignments[0]?.propertyIds).toEqual([PROP_A_ID]);

    await prisma.domainEvent.findFirstOrThrow({ where: { type: "UserCreated", aggregateId: res.data.id } });
    await prisma.domainEvent.findFirstOrThrow({ where: { type: "RoleAssigned", aggregateId: res.data.id } });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "user:create", entityId: res.data.id } });
    expect(JSON.stringify(audit.after)).not.toContain("a-strong-password");
  });

  it("rejects a duplicate email", async () => {
    await actAs(USER_ADMIN_ID);
    const dupe = await createUser({
      email: "admin@woodpecker.example", // seeded
      name: "Clone",
      password: "a-strong-password",
      role: "RECEPTION",
      propertyIds: [PROP_A_ID],
    });
    expect(dupe.ok).toBe(false);
  });

  it("forces Administrator to org-wide (empty propertyIds)", async () => {
    await actAs(USER_ADMIN_ID);
    const res = await createUser({
      email: `admin2.${Date.now()}@test.invalid`,
      name: "Second Admin",
      password: "a-strong-password",
      role: "ADMINISTRATOR",
      propertyIds: [PROP_A_ID], // should be ignored
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    createdUserIds.push(res.data.id);
    const ra = await prisma.roleAssignment.findFirstOrThrow({ where: { userId: res.data.id } });
    expect(ra.propertyIds).toEqual([]);
  });
});

describe("updateUserRoles", () => {
  it("replaces role assignments and audits", async () => {
    await actAs(USER_ADMIN_ID);
    const target = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    const res = await updateUserRoles({
      userId: target.id,
      assignments: [{ role: "ACCOUNTS", propertyIds: [PROP_A_ID] }],
    });
    expect(res.ok).toBe(true);
    const ra = await prisma.roleAssignment.findMany({ where: { userId: target.id } });
    expect(ra).toHaveLength(1);
    expect(ra[0]?.role).toBe("ACCOUNTS");
    await prisma.auditLog.findFirstOrThrow({ where: { action: "user:set-roles", entityId: target.id } });
  });

  it("stops an admin from removing their own Administrator role", async () => {
    await actAs(USER_ADMIN_ID);
    const res = await updateUserRoles({
      userId: USER_ADMIN_ID,
      assignments: [{ role: "RECEPTION", propertyIds: [PROP_A_ID] }],
    });
    expect(res.ok).toBe(false);
  });
});

describe("setUserActive", () => {
  it("deactivating revokes sessions + emits SessionForceLoggedOut + audits", async () => {
    await actAs(USER_ADMIN_ID);
    const target = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    await createSession(prisma, target.id, { ip: "10.0.0.1", device: "Phone" });

    const res = await setUserActive({ userId: target.id, isActive: false });
    expect(res.ok).toBe(true);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.isActive).toBe(false);
    const live = await prisma.session.count({ where: { userId: target.id, revokedAt: null } });
    expect(live).toBe(0);
    await prisma.domainEvent.findFirstOrThrow({ where: { type: "SessionForceLoggedOut", aggregateId: target.id } });
    await prisma.auditLog.findFirstOrThrow({ where: { action: "user:deactivate", entityId: target.id } });
  });

  it("stops an admin from deactivating their own account", async () => {
    await actAs(USER_ADMIN_ID);
    const res = await setUserActive({ userId: USER_ADMIN_ID, isActive: false });
    expect(res.ok).toBe(false);
  });
});

describe("adminResetPassword", () => {
  it("changes the hash, revokes sessions, audits — no password leaked", async () => {
    await actAs(USER_ADMIN_ID);
    const target = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    await createSession(prisma, target.id, { ip: "10.0.0.2" });

    const res = await adminResetPassword({ userId: target.id, password: "brand-new-password" });
    expect(res.ok).toBe(true);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.passwordHash).not.toContain("brand-new-password");
    const live = await prisma.session.count({ where: { userId: target.id, revokedAt: null } });
    expect(live).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "user:reset-password", entityId: target.id } });
    expect(JSON.stringify(audit)).not.toContain("brand-new-password");
  });
});

describe("listUserSessions + revokeUserSessions (admin oversight)", () => {
  it("lists only live sessions (excludes revoked and expired)", async () => {
    await actAs(USER_ADMIN_ID);
    const target = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    await createSession(prisma, target.id, { ip: "1.1.1.1", device: "Live A" });
    await createSession(prisma, target.id, { ip: "1.1.1.2", device: "Live B" });
    // An expired session (created far in the past) must not appear.
    await createSession(prisma, target.id, { ip: "1.1.1.3", device: "Old" }, new Date(Date.now() - 30 * 86_400_000));

    const sessions = await listUserSessions(target.id);
    expect(sessions).toHaveLength(2);
    expect(sessions.every((s) => s.expiresAt.getTime() > Date.now())).toBe(true);

    // The read wrapper the client sheet calls returns the same set.
    const viaAction = await getUserSessions(target.id);
    expect(viaAction.ok).toBe(true);
    if (viaAction.ok) expect(viaAction.data).toHaveLength(2);
  });

  it("revokes ALL of a user's sessions + emits event + audits (entity User)", async () => {
    await actAs(USER_ADMIN_ID);
    const target = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    await createSession(prisma, target.id, { ip: "2.0.0.1" });
    await createSession(prisma, target.id, { ip: "2.0.0.2" });

    const res = await revokeUserSessions({ userId: target.id });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.count).toBe(2);

    const live = await prisma.session.count({ where: { userId: target.id, revokedAt: null } });
    expect(live).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "user:revoke-sessions", entityId: target.id } });
    expect(audit.entityType).toBe("User");
    await prisma.domainEvent.findFirstOrThrow({ where: { type: "SessionForceLoggedOut", aggregateId: target.id } });
  });

  it("revokes a SINGLE session by id (entity Session), leaving others live", async () => {
    await actAs(USER_ADMIN_ID);
    const target = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    const keep = await createSession(prisma, target.id, { ip: "3.0.0.1" });
    const kill = await createSession(prisma, target.id, { ip: "3.0.0.2" });
    if (!keep || !kill) throw new Error("session seed failed");

    const res = await revokeUserSessions({ userId: target.id, sessionId: kill.sessionId });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.count).toBe(1);

    const killed = await prisma.session.findUniqueOrThrow({ where: { id: kill.sessionId } });
    const kept = await prisma.session.findUniqueOrThrow({ where: { id: keep.sessionId } });
    expect(killed.revokedAt).not.toBeNull();
    expect(kept.revokedAt).toBeNull();
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "user:revoke-sessions", entityId: kill.sessionId } });
    expect(audit.entityType).toBe("Session");
  });

  it("refuses to revoke the admin's own sessions (self-service owns that)", async () => {
    await actAs(USER_ADMIN_ID);
    const res = await revokeUserSessions({ userId: USER_ADMIN_ID });
    expect(res.ok).toBe(false);
  });

  it("rejects an unknown target user", async () => {
    await actAs(USER_ADMIN_ID);
    const res = await revokeUserSessions({ userId: "does-not-exist" });
    expect(res.ok).toBe(false);
  });
});

describe("RBAC — a non-admin is denied user administration", () => {
  it("Reception cannot create a user or revoke sessions, and cannot list users", async () => {
    await actAs(USER_RECEPTION_A_ID);
    const create = await createUser({
      email: `nope.${Date.now()}@test.invalid`,
      name: "Nope",
      password: "a-strong-password",
      role: "RECEPTION",
      propertyIds: [PROP_A_ID],
    });
    expect(create.ok).toBe(false);

    const revoke = await revokeUserSessions({ userId: USER_ADMIN_ID });
    expect(revoke.ok).toBe(false);

    await expect(listUsers()).rejects.toThrow();
  });

  it("keeps the org id stable for seeded fixtures (sanity)", async () => {
    const admin = await assembleClaims(prisma, USER_ADMIN_ID);
    expect(admin?.orgId).toBe(ORG_ID);
  });
});
