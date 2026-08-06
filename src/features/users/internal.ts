/**
 * Shared internals for the user-administration actions (module 16).
 * NOT a "use server" module — these helpers must not become endpoints.
 */
import { Prisma, type RoleName } from "@prisma/client";
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";
import type { SessionClaims } from "@/lib/auth/claims";

/**
 * Unscoped by necessity: `User` and `RoleAssignment` are org-level identity
 * tables, not property-scoped operational rows. Every read/write is constrained
 * explicitly by `orgId`, and the caller is always `authorize`-checked for
 * `user:manage` first.
 */
export const usersDb = db.unscoped();

export function withUsersContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
  return runWithContext(
    {
      orgId: user.orgId,
      userId: user.userId,
      propertyScope: user.propertyScope,
      activePropertyId: user.activePropertyId,
      requestId: newRequestId(),
      ip: null,
      device: null,
    },
    fn,
  );
}

export function isUniqueViolation(e: unknown, target?: string): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  if (!target) return true;
  const fields = (e.meta?.target ?? []) as string[] | string;
  return Array.isArray(fields) ? fields.includes(target) : String(fields).includes(target);
}

export type UserRow = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  totpEnabled: boolean;
  lastLoginAt: Date | null;
  roleAssignments: { role: RoleName; propertyIds: string[] }[];
};

export const USER_ROW_SELECT = {
  id: true,
  name: true,
  email: true,
  isActive: true,
  totpEnabled: true,
  lastLoginAt: true,
  roleAssignments: { select: { role: true, propertyIds: true } },
} as const;
