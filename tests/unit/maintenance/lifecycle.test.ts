/**
 * 11 maintenance domain — T-3/T-4 (FR-4/6, AC-5/6). Pure.
 */
import { describe, expect, it } from "vitest";
import { canTransition, nextPreventiveDate } from "@/features/maintenance/domain/lifecycle";

describe("canTransition (AC-5)", () => {
  it("allows the forward path", () => {
    expect(canTransition("OPEN", "IN_PROGRESS")).toBe(true);
    expect(canTransition("OPEN", "CLOSED")).toBe(true);
    expect(canTransition("IN_PROGRESS", "CLOSED")).toBe(true);
  });
  it("rejects reopening a closed job (CLOSED→OPEN)", () => {
    expect(canTransition("CLOSED", "OPEN")).toBe(false);
    expect(canTransition("CLOSED", "IN_PROGRESS")).toBe(false);
  });
});

describe("nextPreventiveDate (AC-6)", () => {
  it("advances monthly by default", () => {
    expect(nextPreventiveDate(new Date("2026-07-15T00:00:00Z"), "monthly")).toEqual(new Date("2026-08-15T00:00:00Z"));
  });
  it("advances weekly / daily", () => {
    expect(nextPreventiveDate(new Date("2026-07-15T00:00:00Z"), "weekly")).toEqual(new Date("2026-07-22T00:00:00Z"));
    expect(nextPreventiveDate(new Date("2026-07-15T00:00:00Z"), "daily")).toEqual(new Date("2026-07-16T00:00:00Z"));
  });
  it("rolls the year across December", () => {
    expect(nextPreventiveDate(new Date("2026-12-15T00:00:00Z"), "monthly")).toEqual(new Date("2027-01-15T00:00:00Z"));
  });
});
