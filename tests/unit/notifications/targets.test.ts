/**
 * Traceability: Phase 3 — notification targeting.
 *
 * A new online booking must reach the desk/management, never operational-only
 * staff. That hinges on "who can view reservations" being resolved from the same
 * permission matrix RBAC uses — so it can't drift from what people can actually see.
 */
import { describe, expect, it } from "vitest";
import { rolesThatCan } from "@/features/notifications/domain/targets";

describe("rolesThatCan(reservation:view)", () => {
  const roles = rolesThatCan("reservation:view");

  it("includes the desk + management roles", () => {
    for (const r of ["ADMINISTRATOR", "MANAGER", "RECEPTION"]) {
      expect(roles).toContain(r);
    }
  });

  it("excludes operational-only roles that can't view reservations", () => {
    for (const r of ["HOUSEKEEPING", "MAINTENANCE"]) {
      expect(roles).not.toContain(r);
    }
  });
});
