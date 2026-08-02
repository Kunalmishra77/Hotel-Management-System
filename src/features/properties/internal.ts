/**
 * Shared internals for the property actions.
 *
 * NOT a "use server" module: everything exported from such a file becomes a
 * callable server action, so these helpers would be exposed as endpoints.
 * Keeping them here also holds each action file under the ~300-line limit
 * (coding-standards.md).
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";
import { ForbiddenError } from "@/lib/errors";
import type { SessionClaims } from "@/lib/auth/claims";

/**
 * Unscoped by necessity: `Property` is the ROOT of the tenancy tree, not a row
 * inside it — a property being created has no id to scope by. Every read/write
 * is constrained explicitly, by `orgId` on create or by `authorize(..., id)`
 * on an existing property.
 */
export const propertyDb = db.unscoped();

/**
 * Creating a property is an ORG-scoped act, so it requires org-wide scope.
 *
 * This reconciles two documents that disagree on their face:
 *   • rbac-matrix.md grants MANAGER `property:manage` (🔒), and
 *   • AC-9 requires a Manager to be denied property CREATION (403).
 * The matrix's own note settles it — "Managers act only within assigned
 * properties" — and a property that does not exist yet is inside nobody's
 * assignment. A Manager may therefore edit their assigned property (audited)
 * but may not bring a new one into existence.
 *
 * Expressed as a scope check rather than a role-name check, because
 * user-roles.md is explicit that the app checks permissions and scope, never
 * role names.
 */
export function assertOrgWideScope(user: SessionClaims): void {
  if (user.propertyScope.kind !== "ALL_IN_ORG") {
    throw new ForbiddenError("Creating a property requires organisation-wide scope", {
      userId: user.userId,
    });
  }
}

export function withPropertyContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
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

/** Prisma's unique-violation code, narrowed to a specific column when given. */
export function isUniqueViolation(e: unknown, target?: string): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  if (!target) return true;
  const fields = (e.meta?.target ?? []) as string[] | string;
  return Array.isArray(fields) ? fields.includes(target) : String(fields).includes(target);
}

export type PropertySummary = {
  id: string;
  name: string;
  code: string;
  city: string;
  state: string;
  isActive: boolean;
};

export const PROPERTY_SUMMARY_SELECT = {
  id: true,
  name: true,
  code: true,
  city: true,
  state: true,
  isActive: true,
} as const;

/** Read a FormData string field, normalising "" to undefined. */
export function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
