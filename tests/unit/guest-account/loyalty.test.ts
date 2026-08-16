/**
 * Traceability: architecture v2 · Phase 6 — guest loyalty tiers (pure).
 */
import { describe, it, expect } from "vitest";
import { loyaltyFor } from "@/features/guest-account/domain/loyalty";

describe("loyaltyFor", () => {
  it("starts at Bronze and climbs by completed stays", () => {
    expect(loyaltyFor(0, 0).tier).toBe("BRONZE");
    expect(loyaltyFor(2, 4).tier).toBe("BRONZE");
    expect(loyaltyFor(3, 6).tier).toBe("SILVER");
    expect(loyaltyFor(5, 9).tier).toBe("SILVER");
    expect(loyaltyFor(6, 12).tier).toBe("GOLD");
    expect(loyaltyFor(20, 60).tier).toBe("GOLD");
  });

  it("reports progress to the next tier, and none at the top", () => {
    const bronze = loyaltyFor(1, 2);
    expect(bronze.nextTier).toBe("Silver");
    expect(bronze.staysToNext).toBe(2);

    const gold = loyaltyFor(8, 20);
    expect(gold.nextTier).toBeNull();
    expect(gold.staysToNext).toBe(0);
  });

  it("carries stays + nights + perks", () => {
    const l = loyaltyFor(4, 11);
    expect(l.stays).toBe(4);
    expect(l.nights).toBe(11);
    expect(l.perks.length).toBeGreaterThan(0);
  });
});
