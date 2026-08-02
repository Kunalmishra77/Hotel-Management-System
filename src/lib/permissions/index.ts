/**
 * The RBAC primitive — 00-platform T-10/T-11/T-12 (FR-11/12/13/14).
 *
 * Deny-by-default: a permission is granted only if the default matrix (or an
 * explicit `PermissionOverride`) says so, AND the target property is inside the
 * caller's scope. `authorize()` is the single guard every mutation calls
 * server-side; UI hiding is cosmetic (security.md).
 */
import type { RoleName } from "@prisma/client";
import { ForbiddenError, OutOfScopeError, DomainError, ErrorCode } from "../errors";
import { scopeIncludes, type PropertyScope } from "../context";
import {
  PERMISSION_MAP,
  isAuditedPermission,
  isPermission,
  requiresReason,
  type Permission,
} from "./permission-map";

export * from "./permission-map";

/** One `RoleAssignment` row, reduced to what authorization needs. */
export type RoleAssignmentClaim = {
  role: RoleName;
  /** Empty ⇒ org-wide (Administrator convention, FR-10). */
  propertyIds: readonly string[];
};

/** One `PermissionOverride` row. */
export type PermissionOverrideClaim = {
  role: RoleName;
  permission: string;
  granted: boolean;
};

/** The authorization-relevant slice of a session (never carries PII — FR-7). */
export type AuthorizedUser = {
  userId: string;
  orgId: string;
  roleAssignments: readonly RoleAssignmentClaim[];
  resolvedPermissions: readonly Permission[];
  propertyScope: PropertyScope;
  activePropertyId: string | null;
};

/**
 * Resolve a user's effective permissions: the union of their roles' default
 * grants, then org overrides applied on top (a `granted: false` override
 * revokes, a `granted: true` override adds).
 *
 * Overrides are keyed by role, so an override only affects a user who actually
 * holds that role — this is what makes a revoke narrow rather than global.
 */
export function resolvePermissions(
  roleAssignments: readonly RoleAssignmentClaim[],
  overrides: readonly PermissionOverrideClaim[] = [],
): Permission[] {
  const held = new Set<RoleName>(roleAssignments.map((r) => r.role));
  const effective = new Set<Permission>();

  for (const role of held) {
    for (const permission of PERMISSION_MAP[role]) effective.add(permission);
  }

  for (const override of overrides) {
    if (!held.has(override.role)) continue;
    // An override naming a permission the app no longer defines is ignored
    // rather than crashing sign-in — stale config must not lock people out.
    if (!isPermission(override.permission)) continue;
    if (override.granted) effective.add(override.permission);
    else effective.delete(override.permission);
  }

  return [...effective].sort();
}

/**
 * Derive the property scope from role assignments (FR-10).
 * Any assignment with an empty `propertyIds` is org-wide and widens the scope
 * to everything — that is the Administrator convention from the schema.
 */
export function resolvePropertyScope(
  roleAssignments: readonly RoleAssignmentClaim[],
): PropertyScope {
  if (roleAssignments.some((r) => r.propertyIds.length === 0)) return { kind: "ALL_IN_ORG" };
  const ids = new Set<string>();
  for (const r of roleAssignments) for (const id of r.propertyIds) ids.add(id);
  return { kind: "PROPERTIES", propertyIds: [...ids].sort() };
}

export function hasPermission(user: AuthorizedUser, permission: Permission): boolean {
  return user.resolvedPermissions.includes(permission);
}

export function canAccessProperty(user: AuthorizedUser, propertyId: string): boolean {
  return scopeIncludes(user.propertyScope, propertyId);
}

export type AuthorizeOptions = {
  /**
   * Justification recorded on the audit row. Mandatory for the permissions in
   * REASON_REQUIRED_PERMISSIONS (FR-14).
   */
  reason?: string | null;
};

/**
 * The guard. Throws — never returns false — so a forgotten `if` cannot silently
 * permit an action.
 *
 * Order matters: the scope check runs BEFORE anything reads data (FR-9), and
 * scope is checked before the permission so a cross-property probe cannot be
 * used to discover which permissions a user holds.
 */
export function authorize(
  user: AuthorizedUser,
  permission: Permission,
  propertyId?: string | null,
  options: AuthorizeOptions = {},
): void {
  if (propertyId != null && !canAccessProperty(user, propertyId)) {
    throw new OutOfScopeError("Property outside caller scope", {
      permission,
      propertyId,
      userId: user.userId,
    });
  }

  if (!hasPermission(user, permission)) {
    throw new ForbiddenError("Permission not granted", {
      permission,
      propertyId,
      userId: user.userId,
    });
  }

  if (requiresReason(permission) && !isNonEmptyReason(options.reason)) {
    throw new DomainError(ErrorCode.REASON_REQUIRED, "Reason required for audited action", {
      permission,
    });
  }
}

function isNonEmptyReason(reason: string | null | undefined): reason is string {
  return typeof reason === "string" && reason.trim().length > 0;
}

/**
 * Non-throwing companion for rendering decisions (nav filtering, disabled
 * buttons). Never use this in place of `authorize()` on a mutation.
 */
export function can(
  user: AuthorizedUser,
  permission: Permission,
  propertyId?: string | null,
): boolean {
  if (propertyId != null && !canAccessProperty(user, propertyId)) return false;
  return hasPermission(user, permission);
}

export { isAuditedPermission, requiresReason };
