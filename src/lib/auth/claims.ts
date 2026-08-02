/**
 * Session-claim assembly — 00 FR-2/FR-7/FR-12, AC-1/AC-7.
 *
 * Claims are rebuilt from the database on every request rather than frozen into
 * a token. That is what makes FR-12 true ("permissions refresh no later than
 * the next request") and what lets a force-logout or a role change take effect
 * immediately (security.md) — a still-unexpired cookie cannot ride stale
 * authority.
 *
 * FR-7/AC-7: claims carry ONLY what authorization needs. No guest PII, and no
 * staff PII beyond the display name and email the shell needs to render.
 */
import type { Prisma, PrismaClient, RoleName } from "@prisma/client";
import type { PropertyScope } from "../context";
import {
  resolvePermissions,
  resolvePropertyScope,
  type Permission,
  type RoleAssignmentClaim,
} from "../permissions";

export type SessionClaims = {
  userId: string;
  orgId: string;
  /** Display-only, for the app shell's user menu. Not guest PII. */
  name: string;
  email: string;
  roleAssignments: RoleAssignmentClaim[];
  resolvedPermissions: Permission[];
  /** The authorization boundary (FR-8). */
  propertyScope: PropertyScope;
  /**
   * The concrete property ids the caller may act on — the switcher's options
   * (FR-27) and the expansion of an ALL_IN_ORG scope.
   */
  accessiblePropertyIds: string[];
  /** The currently switched property (FR-27); null when none is in scope. */
  activePropertyId: string | null;
};

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Build claims for a user. `requestedActivePropertyId` is the value persisted
 * on the Session row; it is re-validated here on every request because a
 * property can be removed from a user's scope while they are signed in
 * (design.md § Edge cases).
 */
export async function assembleClaims(
  db: Db,
  userId: string,
  requestedActivePropertyId: string | null = null,
): Promise<SessionClaims | null> {
  const user = await db.user.findFirst({
    where: { id: userId, isActive: true, deletedAt: null },
    select: {
      id: true,
      orgId: true,
      name: true,
      email: true,
      roleAssignments: { select: { role: true, propertyIds: true } },
    },
  });
  if (!user) return null;

  const roleAssignments: RoleAssignmentClaim[] = user.roleAssignments.map((r) => ({
    role: r.role as RoleName,
    propertyIds: r.propertyIds,
  }));

  // Overrides are per-role and org-scoped; only those for roles the user
  // actually holds can affect them (resolvePermissions enforces that too).
  const overrides = await db.permissionOverride.findMany({
    select: { role: true, permission: true, granted: true },
  });

  const propertyScope = resolvePropertyScope(roleAssignments);
  const resolvedPermissions = resolvePermissions(roleAssignments, overrides);
  const accessiblePropertyIds = await resolveAccessiblePropertyIds(db, user.orgId, propertyScope);

  return {
    userId: user.id,
    orgId: user.orgId,
    name: user.name,
    email: user.email,
    roleAssignments,
    resolvedPermissions,
    propertyScope,
    accessiblePropertyIds,
    activePropertyId: pickActiveProperty(requestedActivePropertyId, accessiblePropertyIds),
  };
}

/**
 * Expand a scope into concrete ids. An org-wide (Administrator) scope resolves
 * to every active property in the org; a bounded scope is intersected with the
 * org's live properties so an id that was deleted or moved cannot linger.
 */
async function resolveAccessiblePropertyIds(
  db: Db,
  orgId: string,
  scope: PropertyScope,
): Promise<string[]> {
  const where =
    scope.kind === "ALL_IN_ORG"
      ? { orgId, isActive: true, deletedAt: null }
      : { orgId, isActive: true, deletedAt: null, id: { in: [...scope.propertyIds] } };

  const rows = await db.property.findMany({
    where,
    select: { id: true },
    orderBy: { code: "asc" },
  });
  return rows.map((r) => r.id);
}

/**
 * Keep the switched property if it is still in scope, else fall back to the
 * first accessible one. Returning a stale id would let a revoked property keep
 * scoping reads (design.md § Edge cases).
 */
export function pickActiveProperty(
  requested: string | null,
  accessiblePropertyIds: readonly string[],
): string | null {
  if (requested && accessiblePropertyIds.includes(requested)) return requested;
  return accessiblePropertyIds[0] ?? null;
}

/**
 * FR-7 / AC-7 guard used by tests and by the session writer: assert no PII-ish
 * key has crept into the claim object. Returns the offending key paths.
 *
 * Deliberately a runtime check rather than a type-level one — the risk is
 * someone widening a `select` in future, which types alone would not catch.
 */
const FORBIDDEN_CLAIM_KEYS = [
  "aadhaar",
  "passport",
  "mobile",
  "phone",
  "whatsapp",
  "dob",
  "address",
  "pan",
  "bank",
  "guest",
  "passwordhash",
  "totpsecret",
  "backupcodes",
  "medical",
];

export function findPiiInClaims(claims: unknown, path = "claims"): string[] {
  const found: string[] = [];

  const walk = (value: unknown, at: string, depth: number): void => {
    if (depth > 6 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${at}[${i}]`, depth + 1));
      return;
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (FORBIDDEN_CLAIM_KEYS.some((f) => lower.includes(f))) found.push(`${at}.${k}`);
      walk(v, `${at}.${k}`, depth + 1);
    }
  };

  walk(claims, path, 0);
  return found;
}
