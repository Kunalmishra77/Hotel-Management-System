/** 12 T-5 — isMarketingAllowed (FR-10, AC-8). */
import { describe, expect, it } from "vitest";
import { isMarketingAllowed, isMarketingCategory } from "@/features/communications/domain/consent";

describe("isMarketingAllowed", () => {
  it("blocks marketing to an opted-out recipient", () => {
    expect(isMarketingAllowed("MARKETING", "OPTED_OUT")).toBe(false);
  });

  it("allows marketing when granted or no row exists (schema default GRANTED)", () => {
    expect(isMarketingAllowed("MARKETING", "GRANTED")).toBe(true);
    expect(isMarketingAllowed("MARKETING", null)).toBe(true);
  });

  it("allows transactional categories regardless of consent (purpose-limitation)", () => {
    expect(isMarketingAllowed("BEFORE_ARRIVAL", "OPTED_OUT")).toBe(true);
    expect(isMarketingAllowed("AFTER_CHECKOUT", "OPTED_OUT")).toBe(true);
    expect(isMarketingAllowed("DURING_STAY", null)).toBe(true);
  });

  it("identifies the marketing category", () => {
    expect(isMarketingCategory("MARKETING")).toBe(true);
    expect(isMarketingCategory("BEFORE_ARRIVAL")).toBe(false);
  });
});
