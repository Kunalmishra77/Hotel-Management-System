import { describe, expect, it } from "vitest";
import { guestTier, VIP_MIN_VISITS, VIP_MIN_REVENUE_PAISE } from "@/features/guest-history/domain/tier";

describe("guestTier", () => {
  it("a first-time / single-stay guest is NEW", () => {
    expect(guestTier({ visits: 0, revenuePaise: 0 }).tier).toBe("NEW");
    expect(guestTier({ visits: 1, revenuePaise: 500_000 }).tier).toBe("NEW");
  });

  it("two or more stays make a REPEAT guest", () => {
    expect(guestTier({ visits: 2, revenuePaise: 0 }).tier).toBe("REPEAT");
    expect(guestTier({ visits: 4, revenuePaise: 900_000 }).tier).toBe("REPEAT");
  });

  it("VIP by visit count", () => {
    expect(guestTier({ visits: VIP_MIN_VISITS, revenuePaise: 0 }).tier).toBe("VIP");
  });

  it("VIP by lifetime revenue even with few visits", () => {
    expect(guestTier({ visits: 1, revenuePaise: VIP_MIN_REVENUE_PAISE }).tier).toBe("VIP");
  });

  it("null revenue (no financial permission) falls back to visits only", () => {
    expect(guestTier({ visits: 3, revenuePaise: null }).tier).toBe("REPEAT");
    expect(guestTier({ visits: 6, revenuePaise: null }).tier).toBe("VIP");
    expect(guestTier({ visits: 1, revenuePaise: null }).tier).toBe("NEW");
  });
});
