/**
 * Traceability: Phase 7 — Lost & Found lifecycle.
 *
 * A STORED item resolves exactly once (claimed or disposed); a resolved item can
 * never be re-resolved. These pure checks back the action's transition guard.
 */
import { describe, expect, it } from "vitest";
import { isResolvable, isResolveStatus } from "@/features/lost-found/domain/status";

describe("isResolvable", () => {
  it("is true only for STORED", () => {
    expect(isResolvable("STORED")).toBe(true);
    expect(isResolvable("CLAIMED")).toBe(false);
    expect(isResolvable("DISPOSED")).toBe(false);
  });
});

describe("isResolveStatus", () => {
  it("accepts CLAIMED/DISPOSED only", () => {
    expect(isResolveStatus("CLAIMED")).toBe(true);
    expect(isResolveStatus("DISPOSED")).toBe(true);
    for (const bad of ["STORED", "", "claimed", null, 5]) expect(isResolveStatus(bad)).toBe(false);
  });
});
