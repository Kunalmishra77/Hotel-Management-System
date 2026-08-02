/**
 * 10 housekeeping domain — T-3/T-4 (FR-5, AC-1/6). Conflict resolution.
 */
import { describe, expect, it } from "vitest";
import { resolveConflict, taskFor } from "@/features/housekeeping/domain/conflict";

describe("resolveConflict (AC-6)", () => {
  it("applies a fresh offline write (client newer than server)", () => {
    const r = resolveConflict(
      { clientUpdatedAt: new Date("2026-07-12T11:00:00Z") },
      { serverStatusChangedAt: new Date("2026-07-12T10:00:00Z") },
    );
    expect(r.apply).toBe(true);
  });

  it("rejects a STALE offline write (client predates server re-occupation)", () => {
    const r = resolveConflict(
      { clientUpdatedAt: new Date("2026-07-12T09:00:00Z") },
      { serverStatusChangedAt: new Date("2026-07-12T10:00:00Z") },
    );
    expect(r.apply).toBe(false);
    if (!r.apply) expect(r.reason).toBe("STALE");
  });

  it("applies when the server has no recorded status change", () => {
    expect(resolveConflict({ clientUpdatedAt: new Date() }, { serverStatusChangedAt: null }).apply).toBe(true);
  });
});

describe("taskFor (AC-1)", () => {
  it("derives a PENDING cleaning task for a room", () => {
    expect(taskFor({ id: "room_1", propertyId: "prop_a" })).toEqual({ propertyId: "prop_a", roomId: "room_1", type: "CLEANING", status: "PENDING" });
  });
});
