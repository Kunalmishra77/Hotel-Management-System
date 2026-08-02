/**
 * Page-level authorization guards — 00 FR-13 (AC-11).
 *
 * "If a mutation's required permission is absent for the caller, reject
 * server-side with FORBIDDEN (403) regardless of what the UI showed."
 *
 * The same holds for a sensitive READ: hiding a nav item stops it being
 * offered, it does not stop it being requested. Every protected page calls one
 * of these, so typing the URL directly is refused by the server.
 */
import { forbidden } from "next/navigation";
import { authorize, type Permission } from "../permissions";
import { isDomainError } from "../errors";
import { requireUser } from ".";
import type { SessionClaims } from "./claims";

/**
 * Assert the caller holds `permission`, else render the 403 boundary.
 *
 * Returns the claims so a page does not have to resolve the session twice.
 * Scope defaults to the active property — the one the page is about to show.
 */
export async function requirePermission(
  permission: Permission,
  propertyId?: string | null,
): Promise<SessionClaims> {
  const claims = await requireUser();

  try {
    authorize(
      claims,
      permission,
      propertyId === undefined ? claims.activePropertyId : propertyId,
      // A page render is a read; the reason requirement belongs to the mutation
      // that follows, which calls authorize() again with the supplied reason.
      { reason: "page-render" },
    );
  } catch (e) {
    if (isDomainError(e)) forbidden();
    throw e;
  }

  return claims;
}
