/**
 * Lost & Found status lifecycle (Phase 7) — pure. STORED is the only active
 * state; it resolves once to CLAIMED (a guest collected it) or DISPOSED.
 */
export const LOST_FOUND_STATUSES = ["STORED", "CLAIMED", "DISPOSED"] as const;
export type LostFoundStatus = (typeof LOST_FOUND_STATUSES)[number];

export const RESOLVE_STATUSES = ["CLAIMED", "DISPOSED"] as const;
export type ResolveStatus = (typeof RESOLVE_STATUSES)[number];

export const LOST_FOUND_STATUS_LABEL: Record<LostFoundStatus, string> = {
  STORED: "In storage",
  CLAIMED: "Claimed",
  DISPOSED: "Disposed",
};

/** Only a STORED item can be resolved (forward-only, single transition). */
export function isResolvable(status: string): boolean {
  return status === "STORED";
}

export function isResolveStatus(v: unknown): v is ResolveStatus {
  return typeof v === "string" && (RESOLVE_STATUSES as readonly string[]).includes(v);
}
