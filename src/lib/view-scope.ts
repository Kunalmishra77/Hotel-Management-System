/**
 * View scope (multi-property redesign) — resolves, per request, whether a page
 * renders CONSOLIDATED across all the caller's hotels ("all") or FOCUSED on one
 * ("focus"). Pure; no session mutation.
 *
 * Rules:
 *  - A single-property user is always FOCUSED on their one hotel (unchanged behaviour).
 *  - A multi-property user (super-admin / group owner) defaults to ALL hotels; a
 *    valid `?property=<id>` drills into one. Removing the param returns to "all".
 *
 * Because the choice rides a URL param — not the session's `activePropertyId` —
 * single-property users are wholly unaffected and "return to all hotels" is just
 * navigation (drop the param).
 */
export type ViewScope =
  | { mode: "all"; propertyIds: string[]; focusedId: null }
  | { mode: "focus"; propertyIds: string[]; focusedId: string };

export type ScopeActorLite = {
  accessiblePropertyIds: readonly string[];
};

export function resolveViewScope(actor: ScopeActorLite, requested?: string | null): ViewScope {
  const accessible = [...actor.accessiblePropertyIds];

  // Single-property (or none): always focused on the one hotel they hold.
  if (accessible.length <= 1) {
    const only = accessible[0];
    return only
      ? { mode: "focus", propertyIds: [only], focusedId: only }
      : { mode: "all", propertyIds: [], focusedId: null };
  }

  // Multi-property: a valid drill-in param focuses one hotel; otherwise all.
  if (requested && accessible.includes(requested)) {
    return { mode: "focus", propertyIds: [requested], focusedId: requested };
  }
  return { mode: "all", propertyIds: accessible, focusedId: null };
}

/** True when this caller can ever see the consolidated multi-hotel view. */
export function isMultiProperty(actor: ScopeActorLite): boolean {
  return actor.accessiblePropertyIds.length > 1;
}

/** Append/replace `?property=` on a path, or clear it (return to "all hotels"). */
export function withProperty(path: string, propertyId: string | null): string {
  const [base, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  if (propertyId) params.set("property", propertyId);
  else params.delete("property");
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base!;
}
