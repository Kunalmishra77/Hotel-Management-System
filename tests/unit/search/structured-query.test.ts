/**
 * 15 T-3 — validateStructuredQuery allow-list (AC-6/AC-11).
 */
import { describe, expect, it } from "vitest";
import { validateStructuredQuery } from "@/features/search/domain/structured-query";
import type { StructuredQuery } from "@/features/search/types";

const base = (over: Partial<StructuredQuery>): StructuredQuery => ({
  entity: "guest",
  filters: [],
  ...over,
});

describe("validateStructuredQuery (AC-6)", () => {
  it("accepts a whitelisted single-entity query (guests in a city)", () => {
    const q = base({ filters: [{ field: "city", op: "eq", value: "Bangalore" }] });
    const res = validateStructuredQuery(q);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual(q);
  });

  it("accepts an `in` list and a date range on whitelisted fields", () => {
    const res = validateStructuredQuery(
      base({
        entity: "reservation",
        filters: [{ field: "source", op: "in", value: ["DIRECT", "AIRBNB"] }],
        dateRange: { field: "checkInDate", from: new Date("2026-01-01"), to: new Date("2026-12-31") },
      }),
    );
    expect(res.ok).toBe(true);
  });
});

describe("rejects non-whitelisted / malformed queries (AC-11)", () => {
  it("rejects an unknown entity", () => {
    expect(() => validateStructuredQuery(base({ entity: "secrets" as never }))).toThrowError(/INVALID_QUERY|entity/i);
  });

  it("rejects a non-whitelisted field (e.g. a raw column / injection attempt)", () => {
    expect(() =>
      validateStructuredQuery(base({ filters: [{ field: "mobileHash", op: "eq", value: "x" }] })),
    ).toThrowError(/INVALID_QUERY|field/i);
  });

  it("rejects a field that exists but with a disallowed operator", () => {
    // gstNumber is exact-match only; contains is not allowed.
    expect(() =>
      validateStructuredQuery(base({ filters: [{ field: "gstNumber", op: "contains", value: "29" }] })),
    ).toThrowError(/INVALID_QUERY|operator/i);
  });

  it("rejects a `;`/`--` laden pseudo-SQL field name with code INVALID_QUERY", () => {
    expect(() =>
      validateStructuredQuery(base({ filters: [{ field: "city; drop table guest --", op: "eq", value: "x" }] })),
    ).toThrowError(expect.objectContaining({ code: "INVALID_QUERY" }));
  });

  it("rejects an out-of-range limit", () => {
    expect(() => validateStructuredQuery(base({ limit: 100000 }))).toThrowError(/INVALID_QUERY|limit/i);
  });
});
