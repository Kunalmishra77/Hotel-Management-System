import { describe, expect, it } from "vitest";
import { commissionPaise, netAfterCommission } from "@/features/command-center/domain/commission";

describe("commissionPaise", () => {
  it("applies the OTA rate to gross revenue", () => {
    expect(commissionPaise("BOOKING_COM", 10_000)).toBe(1_800); // 18% of ₹100
    expect(commissionPaise("MAKEMYTRIP", 10_000)).toBe(2_000); // 20%
    expect(commissionPaise("AIRBNB", 10_000)).toBe(1_500); // 15%
  });
  it("is zero for direct channels", () => {
    for (const s of ["DIRECT", "WEBSITE", "PHONE", "WALK_IN", "CORPORATE"]) {
      expect(commissionPaise(s, 10_000)).toBe(0);
    }
  });
});

describe("netAfterCommission", () => {
  it("nets gross minus total commission across sources", () => {
    const r = netAfterCommission(
      [
        { source: "BOOKING_COM", revenuePaise: 10_000 }, // −1,800
        { source: "DIRECT", revenuePaise: 10_000 }, // −0
      ],
      20_000,
    );
    expect(r.commissionPaise).toBe(1_800);
    expect(r.netPaise).toBe(18_200);
  });
});
