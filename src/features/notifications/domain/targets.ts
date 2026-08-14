/**
 * Notification targeting (Phase 3) — pure. Who should hear about an event = the
 * roles that hold the relevant permission. Kept pure so it unit-tests without a
 * DB; the consumer joins these roles to property-scoped RoleAssignments.
 */
import type { RoleName } from "@prisma/client";
import { PERMISSION_MATRIX, type Permission } from "@/lib/permissions/permission-map";

/** Every role that holds `permission` at any grant level. */
export function rolesThatCan(permission: Permission): RoleName[] {
  return Object.keys(PERMISSION_MATRIX[permission]) as RoleName[];
}
