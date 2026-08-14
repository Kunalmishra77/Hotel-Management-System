/**
 * Traceability: Phase 4 — in-room request taxonomy.
 *
 * The status machine is forward-only (a completed request can't reopen) and the
 * department routing decides who gets notified — both are pure and load-bearing.
 */
import { describe, expect, it } from "vitest";
import {
  isGuestRequestKind,
  departmentPermissionForKind,
  NEXT_STATUSES,
  ACTIVE_REQUEST_STATUSES,
} from "@/features/guest-account/domain/request-kind";

describe("isGuestRequestKind", () => {
  it("accepts the four kinds and rejects anything else", () => {
    for (const k of ["HOUSEKEEPING", "MAINTENANCE", "AMENITY", "OTHER"]) expect(isGuestRequestKind(k)).toBe(true);
    for (const bad of ["", "FOOD", "housekeeping", 5, null]) expect(isGuestRequestKind(bad)).toBe(false);
  });
});

describe("departmentPermissionForKind", () => {
  it("routes housekeeping + maintenance to their departments, others to reception only", () => {
    expect(departmentPermissionForKind("HOUSEKEEPING")).toBe("housekeeping:update");
    expect(departmentPermissionForKind("MAINTENANCE")).toBe("maintenance:manage");
    expect(departmentPermissionForKind("AMENITY")).toBeNull();
    expect(departmentPermissionForKind("OTHER")).toBeNull();
  });
});

describe("NEXT_STATUSES (forward-only)", () => {
  it("lets an open request advance but never reopens a resolved one", () => {
    expect(NEXT_STATUSES.OPEN).toContain("ACKNOWLEDGED");
    expect(NEXT_STATUSES.OPEN).toContain("DONE");
    expect(NEXT_STATUSES.IN_PROGRESS).toEqual(["DONE", "DECLINED"]);
    expect(NEXT_STATUSES.DONE).toEqual([]);
    expect(NEXT_STATUSES.DECLINED).toEqual([]);
  });

  it("never lets a status transition back to OPEN", () => {
    for (const from of Object.keys(NEXT_STATUSES)) {
      expect(NEXT_STATUSES[from]).not.toContain("OPEN");
    }
  });

  it("active statuses are the non-terminal ones", () => {
    expect([...ACTIVE_REQUEST_STATUSES]).toEqual(["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"]);
  });
});
