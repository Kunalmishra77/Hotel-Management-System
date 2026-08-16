/**
 * Guest loyalty (architecture v2 · Phase 6, customer). Pure — a tier derived from
 * completed stays, with perks and progress to the next tier. Nights are the points.
 */
export type LoyaltyTier = "BRONZE" | "SILVER" | "GOLD";

export type Loyalty = {
  tier: LoyaltyTier;
  tierName: string;
  stays: number;
  nights: number;
  perks: string[];
  nextTier: string | null;
  staysToNext: number; // 0 when at the top
};

const TIERS: { id: LoyaltyTier; name: string; minStays: number; perks: string[] }[] = [
  { id: "BRONZE", name: "Bronze", minStays: 0, perks: ["Member-only direct rates", "Free Wi-Fi"] },
  { id: "SILVER", name: "Silver", minStays: 3, perks: ["Everything in Bronze", "Priority check-in", "Late checkout when available"] },
  { id: "GOLD", name: "Gold", minStays: 6, perks: ["Everything in Silver", "Room upgrade when available", "Welcome amenity", "Dedicated support"] },
];

export function loyaltyFor(stays: number, nights: number): Loyalty {
  let idx = 0;
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (stays >= TIERS[i]!.minStays) { idx = i; break; }
  }
  const t = TIERS[idx]!;
  const next = TIERS[idx + 1] ?? null;
  return {
    tier: t.id,
    tierName: t.name,
    stays,
    nights,
    perks: t.perks,
    nextTier: next?.name ?? null,
    staysToNext: next ? Math.max(0, next.minStays - stays) : 0,
  };
}
