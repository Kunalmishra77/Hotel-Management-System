/**
 * Throwaway users for tests that need to MUTATE a user.
 *
 * The seeded fixtures (U-ADMIN, U-REC-A, U-ACC) are asserted on by many test
 * files, so they must stay read-only. A test that flips a shared fixture's role
 * and then fails before restoring it leaves the database dirty and breaks every
 * later run — which is exactly what happened once. Anything that writes to a
 * user creates its own here instead.
 */
import type { PrismaClient, RoleName } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { hashPassword } from "@/lib/auth/password";
import { ORG_ID } from "../../prisma/seed/fixtures";

export const TEMP_USER_PREFIX = "tmpuser_";

export type TempUserOptions = {
  role: RoleName;
  propertyIds?: string[];
  password?: string;
  isActive?: boolean;
  totpEnabled?: boolean;
  totpSecret?: string | null;
  backupCodes?: string[];
};

export type TempUser = { id: string; email: string; password: string };

/**
 * bcrypt at cost 12 costs ~400ms by design, and the integration suite creates
 * dozens of temp users. Hashing the same fixture password once per process
 * keeps the suite usable without weakening anything: the stored value is still
 * a real cost-12 hash, so tests that verify it exercise the real code path.
 */
const hashCache = new Map<string, Promise<string>>();

function cachedHash(password: string): Promise<string> {
  const hit = hashCache.get(password);
  if (hit) return hit;
  const promise = hashPassword(password);
  hashCache.set(password, promise);
  return promise;
}

export async function createTempUser(
  prisma: PrismaClient,
  options: TempUserOptions,
): Promise<TempUser> {
  const suffix = randomUUID().slice(0, 8);
  const id = `${TEMP_USER_PREFIX}${suffix}`;
  const email = `${id}@test.invalid`;
  const password = options.password ?? "temp-user-password-2026";

  await prisma.user.create({
    data: {
      id,
      orgId: ORG_ID,
      email,
      name: `Temp ${suffix}`,
      passwordHash: await cachedHash(password),
      isActive: options.isActive ?? true,
      totpEnabled: options.totpEnabled ?? false,
      totpSecret: options.totpSecret ?? null,
      backupCodes: options.backupCodes ?? [],
      roleAssignments: {
        create: { role: options.role, propertyIds: options.propertyIds ?? [] },
      },
    },
  });

  return { id, email, password };
}

/** Remove every temp user and its dependent rows. Safe to call repeatedly. */
export async function cleanupTempUsers(prisma: PrismaClient): Promise<void> {
  const where = { id: { startsWith: TEMP_USER_PREFIX } };
  const users = await prisma.user.findMany({ where, select: { id: true } });
  if (users.length === 0) return;
  const userIds = users.map((u) => u.id);

  // Children first — these FKs are Restrict, not Cascade.
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.roleAssignment.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where });
}
