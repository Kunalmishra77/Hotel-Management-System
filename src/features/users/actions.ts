"use server";

/**
 * User-administration server actions (module 16 — FR-13). Admin-only.
 * Canonical write path: validate → authorize → transaction → event → audit → Result.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { hashPassword } from "@/lib/auth/password";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import {
  adminResetPasswordSchema,
  createUserSchema,
  setUserActiveSchema,
  updateUserRolesSchema,
} from "./schema";
import { isUniqueViolation, usersDb, withUsersContext } from "./internal";

export type CreatedUser = { id: string; name: string; email: string };

async function assertTargetInOrg(orgId: string, userId: string): Promise<void> {
  const target = await usersDb.user.findFirst({
    where: { id: userId, orgId, deletedAt: null },
    select: { id: true },
  });
  if (!target) throw new NotFoundError("User not found.", { userId });
}

export async function createUser(input: unknown): Promise<Result<CreatedUser>> {
  return toResult(async () => {
    const data = createUserSchema.parse(input);
    const admin = await requireUser();
    authorize(admin, "user:manage");

    const propertyIds = data.role === "ADMINISTRATOR" ? [] : data.propertyIds;
    const passwordHash = await hashPassword(data.password);

    const created = await withUsersContext(admin, () =>
      usersDb.$transaction(async (tx) => {
        let row: CreatedUser;
        try {
          row = await tx.user.create({
            data: { orgId: admin.orgId, email: data.email, name: data.name, passwordHash, isActive: true },
            select: { id: true, name: true, email: true },
          });
        } catch (e) {
          if (isUniqueViolation(e, "email")) {
            throw new ConflictError("That email address is already in use.", { email: data.email });
          }
          throw e;
        }
        await tx.roleAssignment.create({ data: { userId: row.id, role: data.role, propertyIds } });
        await emitEvent(tx, { type: "UserCreated", aggregateId: row.id, payload: { email: row.email } });
        await emitEvent(tx, { type: "RoleAssigned", aggregateId: row.id, payload: { role: data.role, propertyIds } });
        await writeAudit(tx, {
          action: "user:create",
          entityType: "User",
          entityId: row.id,
          after: { email: row.email, name: row.name, role: data.role, propertyIds },
        });
        return row;
      }),
    );

    revalidatePath("/settings/users");
    return created;
  });
}

export async function updateUserRoles(input: unknown): Promise<Result<{ ok: true }>> {
  return toResult(async () => {
    const data = updateUserRolesSchema.parse(input);
    const admin = await requireUser();
    authorize(admin, "user:manage");

    // Lockout guard: an admin cannot strip their own Administrator role.
    if (data.userId === admin.userId && !data.assignments.some((a) => a.role === "ADMINISTRATOR")) {
      throw new ForbiddenError("You can't remove your own Administrator role.", { userId: admin.userId });
    }
    await assertTargetInOrg(admin.orgId, data.userId);

    await withUsersContext(admin, () =>
      usersDb.$transaction(async (tx) => {
        await tx.roleAssignment.deleteMany({ where: { userId: data.userId } });
        await tx.roleAssignment.createMany({
          data: data.assignments.map((a) => ({
            userId: data.userId,
            role: a.role,
            propertyIds: a.role === "ADMINISTRATOR" ? [] : a.propertyIds,
          })),
        });
        await emitEvent(tx, { type: "RoleAssigned", aggregateId: data.userId, payload: { assignments: data.assignments } });
        await writeAudit(tx, {
          action: "user:set-roles",
          entityType: "User",
          entityId: data.userId,
          after: { assignments: data.assignments },
        });
      }),
    );

    revalidatePath("/settings/users");
    return { ok: true as const };
  });
}

export async function setUserActive(input: unknown): Promise<Result<{ ok: true }>> {
  return toResult(async () => {
    const data = setUserActiveSchema.parse(input);
    const admin = await requireUser();
    authorize(admin, "user:manage");

    if (data.userId === admin.userId && !data.isActive) {
      throw new ForbiddenError("You can't deactivate your own account.", { userId: admin.userId });
    }
    await assertTargetInOrg(admin.orgId, data.userId);

    await withUsersContext(admin, () =>
      usersDb.$transaction(async (tx) => {
        await tx.user.update({ where: { id: data.userId }, data: { isActive: data.isActive } });
        if (!data.isActive) {
          const revoked = await tx.session.updateMany({
            where: { userId: data.userId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          await emitEvent(tx, {
            type: "SessionForceLoggedOut",
            aggregateId: data.userId,
            payload: { reason: "deactivated", sessionsRevoked: revoked.count },
          });
        }
        await writeAudit(tx, {
          action: data.isActive ? "user:activate" : "user:deactivate",
          entityType: "User",
          entityId: data.userId,
        });
      }),
    );

    revalidatePath("/settings/users");
    return { ok: true as const };
  });
}

export async function adminResetPassword(input: unknown): Promise<Result<{ ok: true }>> {
  return toResult(async () => {
    const data = adminResetPasswordSchema.parse(input);
    const admin = await requireUser();
    authorize(admin, "user:manage");
    await assertTargetInOrg(admin.orgId, data.userId);

    const passwordHash = await hashPassword(data.password);
    await withUsersContext(admin, () =>
      usersDb.$transaction(async (tx) => {
        await tx.user.update({ where: { id: data.userId }, data: { passwordHash } });
        const revoked = await tx.session.updateMany({
          where: { userId: data.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await emitEvent(tx, {
          type: "SessionForceLoggedOut",
          aggregateId: data.userId,
          payload: { reason: "admin-reset", sessionsRevoked: revoked.count },
        });
        await writeAudit(tx, { action: "user:reset-password", entityType: "User", entityId: data.userId });
      }),
    );

    revalidatePath("/settings/users");
    return { ok: true as const };
  });
}
