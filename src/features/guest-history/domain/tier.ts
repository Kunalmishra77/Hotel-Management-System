/**
 * Guest tier — a derived CRM segment from stay history (05), so the front desk
 * instantly sees who a returning or high-value guest is. Pure + deterministic
 * (unit-tested); computed from figures that already come off `getGuestHistory`.
 *
 * Tier is derived, never stored (business-rules.md §17 — history is derived).
 * Revenue may be null when the caller lacks `report:view-financial`; tier then
 * falls back to visit count alone (visits are always visible).
 */
export type GuestTier = "NEW" | "REPEAT" | "VIP";

export type GuestTierInfo = { tier: GuestTier; label: string };

/** A guest reaches VIP at this many stays OR this much lifetime room-revenue. */
export const VIP_MIN_VISITS = 5;
export const VIP_MIN_REVENUE_PAISE = 10_000_000; // ₹1,00,000 lifetime

export function guestTier(input: { visits: number; revenuePaise: number | null }): GuestTierInfo {
  const visits = Math.max(0, input.visits);
  const revenue = input.revenuePaise ?? 0;

  if (visits >= VIP_MIN_VISITS || revenue >= VIP_MIN_REVENUE_PAISE) {
    return { tier: "VIP", label: "VIP" };
  }
  if (visits >= 2) return { tier: "REPEAT", label: "Repeat guest" };
  return { tier: "NEW", label: "New guest" };
}
