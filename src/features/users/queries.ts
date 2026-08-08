import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { NotFoundError } from "@/lib/errors";
import { usersDb, USER_ROW_SELECT, type UserRow } from "./internal";

export type AdminSessionView = {
  id: string;
  ip: string | null;
  device: string | null;
  createdAt: Date;
  expiresAt: Date;
};

/** Every user in the org (user-admin surface). Admin-only. */
export async function listUsers(): Promise<UserRow[]> {
  const user = await requireUser();
  authorize(user, "user:manage");
  return usersDb.user.findMany({
    where: { orgId: user.orgId, deletedAt: null },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: USER_ROW_SELECT,
  });
}

/**
 * A target user's live sessions (admin oversight — FR-13). Admin-only, and the
 * target must belong to the caller's org. Unlike `listActiveSessions` (self
 * only), this lets an Administrator inspect another user's devices before a
 * force sign-out. Never returns revoked/expired rows.
 */
export async function listUserSessions(userId: string): Promise<AdminSessionView[]> {
  const admin = await requireUser();
  authorize(admin, "user:manage");
  const target = await usersDb.user.findFirst({
    where: { id: userId, orgId: admin.orgId, deletedAt: null },
    select: { id: true },
  });
  if (!target) throw new NotFoundError("User not found.", { userId });
  return usersDb.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, ip: true, device: true, createdAt: true, expiresAt: true },
  });
}

/** Properties in the org, for the role-scope selector. Admin-only. */
export async function listOrgProperties(): Promise<{ id: string; name: string }[]> {
  const user = await requireUser();
  authorize(user, "user:manage");
  return usersDb.property.findMany({
    where: { orgId: user.orgId, isActive: true, deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
