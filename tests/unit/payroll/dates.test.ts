/** 21 domain — month/date helpers (FR-3). Pure, deterministic. */
import { describe, expect, it } from "vitest";
import { DEFAULT_PAYROLL_CONFIG } from "@/lib/constants/payroll";
import { daysInBasis, daysInMonth, inclusiveDaySpan, isSameDay, monthBounds, parseMonth } from "@/features/payroll/domain/dates";

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("dates", () => {
  it("daysInMonth handles 31/30/28/leap-29", () => {
    expect(daysInMonth("2026-07")).toBe(31);
    expect(daysInMonth("2026-04")).toBe(30);
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2024-02")).toBe(29);
  });

  it("monthBounds returns UTC-midnight first/last day", () => {
    const { start, end } = monthBounds("2026-07");
    expect(start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-31T00:00:00.000Z");
  });

  it("daysInBasis is calendar days by default, or the pinned config value", () => {
    expect(daysInBasis("2026-07", DEFAULT_PAYROLL_CONFIG)).toBe(31);
    expect(daysInBasis("2026-07", { ...DEFAULT_PAYROLL_CONFIG, dayBasis: 30 })).toBe(30);
  });

  it("inclusiveDaySpan counts both ends; zero when reversed", () => {
    expect(inclusiveDaySpan(D("2026-07-01"), D("2026-07-31"))).toBe(31);
    expect(inclusiveDaySpan(D("2026-07-16"), D("2026-07-16"))).toBe(1);
    expect(inclusiveDaySpan(D("2026-07-31"), D("2026-07-01"))).toBe(0);
  });

  it("isSameDay compares calendar day", () => {
    expect(isSameDay(D("2026-07-05"), new Date("2026-07-05T18:00:00Z"))).toBe(true);
    expect(isSameDay(D("2026-07-05"), D("2026-07-06"))).toBe(false);
  });

  it("parseMonth rejects malformed input", () => {
    expect(() => parseMonth("2026-13")).toThrow();
    expect(() => parseMonth("bad")).toThrow();
  });
});
