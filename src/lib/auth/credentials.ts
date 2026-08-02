/**
 * Credentials verification — 00 FR-1/FR-2, AC-1.
 *
 * Returns a discriminated outcome rather than throwing, so the caller decides
 * what to reveal. Every rejection an attacker can trigger from outside maps to
 * the SAME client-facing error (FR-4, no account enumeration); the distinct
 * variants exist for audit and for driving the 2FA challenge, not for display.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { verifyPassword } from "./password";

type Db = PrismaClient | Prisma.TransactionClient;

export type CredentialOutcome =
  | { kind: "OK"; userId: string; orgId: string; requiresTotp: boolean }
  /**
   * `userId`/`orgId` are present ONLY when the email matched but the password
   * did not — that is what lets the caller increment the lockout counter for a
   * real account (FR-4). They are absent for an unknown email, so nothing about
   * account existence leaks: the caller returns the same message either way.
   */
  | { kind: "INVALID"; userId?: string; orgId?: string }
  | { kind: "INACTIVE"; userId: string }
  | { kind: "LOCKED"; userId: string; lockedUntil: Date };

/**
 * A bcrypt hash of a throwaway value, used to equalise timing when the email
 * does not exist. Without it, "no such user" returns in ~1ms while a real user
 * costs ~300ms of bcrypt — a trivially measurable enumeration oracle that would
 * defeat FR-4's identical-error requirement.
 */
const TIMING_EQUALISER_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.WQ1cJPUuTZUJ4L2Xn5qkOaBcQ6dGZ0K";

export type VerifyCredentialsOptions = {
  /** Injected clock — lockout comparisons must be deterministic in tests. */
  now?: Date;
};

export async function verifyCredentials(
  db: Db,
  email: string,
  password: string,
  options: VerifyCredentialsOptions = {},
): Promise<CredentialOutcome> {
  const now = options.now ?? new Date();
  const normalizedEmail = email.trim().toLowerCase();

  const user = await db.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      orgId: true,
      passwordHash: true,
      isActive: true,
      deletedAt: true,
      totpEnabled: true,
      lockedUntil: true,
      roleAssignments: { select: { role: true } },
    },
  });

  if (!user || user.deletedAt !== null) {
    // Spend comparable time so the response is indistinguishable from a real
    // account with a wrong password.
    await verifyPassword(password, TIMING_EQUALISER_HASH);
    return { kind: "INVALID" };
  }

  // Lockout is checked before the password so a locked account cannot be used
  // as an oracle to confirm a guessed password (FR-4).
  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    await verifyPassword(password, TIMING_EQUALISER_HASH);
    return { kind: "LOCKED", userId: user.id, lockedUntil: user.lockedUntil };
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk) return { kind: "INVALID", userId: user.id, orgId: user.orgId };

  if (!user.isActive) return { kind: "INACTIVE", userId: user.id };

  const requiresTotp = await isTotpRequired(db, {
    orgId: user.orgId,
    totpEnabled: user.totpEnabled,
    roles: user.roleAssignments.map((r) => r.role),
  });

  return { kind: "OK", userId: user.id, orgId: user.orgId, requiresTotp };
}

/**
 * FR-3/FR-5: 2FA applies when the user enabled it individually OR when any of
 * their roles appears in `SecuritySettings.enforced2faRoles`.
 */
export async function isTotpRequired(
  db: Db,
  user: { orgId: string; totpEnabled: boolean; roles: readonly string[] },
): Promise<boolean> {
  if (user.totpEnabled) return true;

  const settings = await db.securitySettings.findUnique({
    where: { orgId: user.orgId },
    select: { enforced2faRoles: true },
  });
  if (!settings) return false;

  return user.roles.some((r) => (settings.enforced2faRoles as string[]).includes(r));
}
