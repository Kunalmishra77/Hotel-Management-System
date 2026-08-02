/**
 * Shared internals for the auth actions.
 *
 * Deliberately NOT a "use server" module: everything Next exports from such a
 * file becomes a callable server action, so helpers like `safeNext` would be
 * exposed as endpoints. Keeping them here means the action files stay under the
 * ~300-line limit (coding-standards.md) without widening the attack surface.
 */
import { db } from "@/lib/db";
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
