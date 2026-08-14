/**
 * Shared internals for the auth actions.
 *
 * Deliberately NOT a "use server" module: everything Next exports from such a
 * file becomes a callable server action, so helpers like `safeNext` would be
 * exposed as endpoints. Keeping them here means the action files stay under the
 * ~300-line limit (coding-standards.md) without widening the attack surface.
 */
import type { RoleName } from "@prisma/client";
import { db } from "@/lib/db";
import { assembleClaims } from "@/lib/auth/claims";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { newRequestId, runWithContext } from "@/lib/context";

/**
 * Unscoped by necessity. Authentication runs BEFORE a session exists, so there
 * is no property scope to filter by; and its subjects — User, Session,
 * PasswordResetToken — are org-level, not property-scoped operational data.
 * Every read is keyed by the caller-supplied credential, never by property.
 * This is the documented escape hatch, used deliberately.
 */
export const authDb = db.unscoped();

/** The single message every failed sign-in returns (FR-4, AC-4). */
export const GENERIC_SIGN_IN_ERROR = "Incorrect email or password.";

/**
 * Only allow same-site relative redirects. An open redirect here would let a
 * phishing link bounce a freshly-authenticated user to an attacker's page.
 */
export function safeNext(next: string | undefined): string {
  if (!next) return "/dashboard";
  if (!next.startsWith("/") || next.startsWith("//")) return "/dashboard";
  return next;
}

/**
 * Role-based landing after sign-in (auth standard: role-based redirects). An
 * explicit same-site `next` wins — a deep link or a session-expiry bounce-back
 * should return the user where they were headed. Otherwise route to the role's
 * home. Resolved from the DB by userId because the freshly-written session
 * cookie is not readable in the same request that sets it.
 */
export async function landingRoute(userId: string, next: string | undefined): Promise<string> {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  const claims = await assembleClaims(authDb, userId);
  if (!claims) return "/dashboard";

  // Multi-property redesign: a user who spans more than one hotel and can read
  // financials (super-admin / group manager) lands on the CONSOLIDATED command
  // centre — their default is "all hotels at once", not a single focused hotel.
  const roles = new Set<RoleName>(claims.roleAssignments.map((r) => r.role));
  if (claims.accessiblePropertyIds.length > 1 && claims.resolvedPermissions.includes("report:view-financial")) {
    return "/overview";
  }
  if (roles.has("OWNER")) return "/owner";
  if (roles.has("ADMINISTRATOR") || roles.has("MANAGER") || roles.has("ASSISTANT_MANAGER")) return "/dashboard";
  if (roles.has("RECEPTION")) return "/bookings";
  if (roles.has("ACCOUNTS")) return "/billing";
  if (roles.has("HR")) return "/staff";
  if (roles.has("POS_MANAGER")) return "/pos";
  if (roles.has("INVENTORY_MANAGER") || roles.has("PURCHASE_MANAGER") || roles.has("LAUNDRY_SUPERVISOR"))
    return "/inventory";
  if (roles.has("HOUSEKEEPING")) return "/housekeeping";
  if (roles.has("MAINTENANCE")) return "/maintenance";
  return "/dashboard";
}

/**
 * Run `fn` inside a request context for a user who has no property scope yet
 * (sign-in, sign-out, password reset all happen before or outside one).
 */
export function withUserContext<T>(
  orgId: string,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithContext(
    {
      orgId,
      userId,
      propertyScope: { kind: "PROPERTIES", propertyIds: [] },
      activePropertyId: null,
      requestId: newRequestId(),
      ip: null,
      device: null,
    },
    fn,
  );
}

/**
 * Record a sign-in: `UserSignedIn` event + audit row in ONE transaction
 * (design.md § Events; FR-15/FR-17).
 */
export async function recordSignIn(
  userId: string,
  orgId: string,
  usedTwoFactor: boolean,
): Promise<void> {
  await withUserContext(orgId, userId, () =>
    authDb.$transaction(async (tx) => {
      await emitEvent(tx, {
        type: "UserSignedIn",
        aggregateId: userId,
        payload: { usedTwoFactor },
      });
      await writeAudit(tx, {
        action: "auth:sign-in",
        entityType: "User",
        entityId: userId,
        after: { usedTwoFactor },
      });
    }),
  );
}
