/**
 * 25 receivables aging — T-4 (FR-2/7, AC-7). Pure, BigInt paise, FIFO payments.
 */
import { describe, expect, it } from "vitest";
import { aging } from "@/features/corporate/domain/aging";

const ASOF = new Date("2026-08-01T00:00:00.000Z");
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

// Three charges landing in three different buckets relative to ASOF.
const charges = [
  { amountPaise: 10_000n, date: d("2026-07-20") }, // 12 days → current (0-30)
  { amountPaise: 20_000n, date: d("2026-06-15") }, // 47 days → 31-60
  { amountPaise: 40_000n, date: d("2026-04-15") }, // 108 days → 90+
];

describe("aging (AC-7)", () => {
  it("buckets each unpaid charge by age when nothing is paid", () => {
    const b = aging(charges, 0n, ASOF);
    expect(b.current).toBe(10_000n);
    expect(b.days31to60).toBe(20_000n);
    expect(b.days90plus).toBe(40_000n);
    expect(b.days61to90).toBe(0n);
    expect(b.totalPaise).toBe(70_000n);
  });

  it("applies payments to the OLDEST charge first (FIFO)", () => {
    // ₹400 clears the oldest (90+) charge entirely.
    const b = aging(charges, 40_000n, ASOF);
    expect(b.days90plus).toBe(0n);
    expect(b.days31to60).toBe(20_000n);
    expect(b.current).toBe(10_000n);
    expect(b.totalPaise).toBe(30_000n);
  });

  it("partially clears across buckets oldest-first", () => {
    // ₹500 clears the 90+ (₹400) then ₹100 of the 31-60 (₹200 → ₹100 left).
    const b = aging(charges, 50_000n, ASOF);
    expect(b.days90plus).toBe(0n);
    expect(b.days31to60).toBe(10_000n);
    expect(b.current).toBe(10_000n);
    expect(b.totalPaise).toBe(20_000n);
  });

  it("a fully-paid account has empty buckets", () => {
    const b = aging(charges, 70_000n, ASOF);
    expect(b.totalPaise).toBe(0n);
  });

  it("ignores non-positive charges", () => {
    const b = aging([{ amountPaise: 0n, date: d("2026-07-01") }], 0n, ASOF);
    expect(b.totalPaise).toBe(0n);
  });
});
