/** 26 T-5 — dedupPlan within-file + against existing (FR-3/6, AC-5/11). */
import { describe, expect, it } from "vitest";
import { dedupPlan, type PlanRow } from "@/features/data-onboarding/domain/dedup-plan";

const row = (rowNum: number, importKey: string | null, ok = true): PlanRow => ({ rowNum, importKey, ok });

describe("dedupPlan", () => {
  it("first occurrence CREATE, later in-file duplicates SKIP (AC-5)", () => {
    const plan = dedupPlan({
      rows: [row(1, "GUESTS:9800000101"), row(2, "GUESTS:9800000102"), row(3, "GUESTS:9800000101")],
      existingKeys: new Set(),
    });
    expect(plan.get(1)).toBe("CREATE");
    expect(plan.get(2)).toBe("CREATE");
    expect(plan.get(3)).toBe("SKIP");
  });

  it("a key already in the DB is SKIP — the idempotent re-import (AC-11)", () => {
    const plan = dedupPlan({
      rows: [row(1, "GUESTS:9800000101"), row(2, "GUESTS:9800000102")],
      existingKeys: new Set(["GUESTS:9800000101"]),
    });
    expect(plan.get(1)).toBe("SKIP");
    expect(plan.get(2)).toBe("CREATE");
  });

  it("omits ERROR rows and keyless rows from the plan", () => {
    const plan = dedupPlan({
      rows: [row(1, null), row(2, "GUESTS:x", false), row(3, "GUESTS:y")],
      existingKeys: new Set(),
    });
    expect(plan.has(1)).toBe(false);
    expect(plan.has(2)).toBe(false);
    expect(plan.get(3)).toBe("CREATE");
  });

  it("is order-stable regardless of input order", () => {
    const plan = dedupPlan({
      rows: [row(3, "k"), row(1, "k"), row(2, "k")],
      existingKeys: new Set(),
    });
    expect(plan.get(1)).toBe("CREATE"); // lowest rowNum wins the CREATE
    expect(plan.get(2)).toBe("SKIP");
    expect(plan.get(3)).toBe("SKIP");
  });
});
