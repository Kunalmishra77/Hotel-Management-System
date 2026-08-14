/**
 * Traceability: architecture v2 · Phase 1 — role-scoped portals.
 *
 * Each role must land in exactly its blueprint portal and see only that portal's
 * modules (still intersected with held permissions). A multi-role user gets the
 * highest-privilege portal; an unmapped role falls back to the flat nav.
 */
import { describe, it, expect } from "vitest";
import type { RoleName } from "@prisma/client";
import { resolvePortal, portalNavItems } from "@/features/platform/portals";
import { NAV_ITEMS } from "@/features/platform/navigation";

const roles = (xs: string[]): RoleName[] => xs as RoleName[];
const ALL_PERMS = [...new Set(NAV_ITEMS.map((i) => i.permission))];
const keysFor = (rs: string[]) => portalNavItems(roles(rs), ALL_PERMS).map((i) => i.key);

describe("resolvePortal", () => {
  it("maps each role to its portal", () => {
    expect(resolvePortal(roles(["ADMINISTRATOR"]))).toBe("SUPER_ADMIN");
    expect(resolvePortal(roles(["OWNER"]))).toBe("OWNER");
    expect(resolvePortal(roles(["MANAGER"]))).toBe("MANAGER");
    expect(resolvePortal(roles(["ASSISTANT_MANAGER"]))).toBe("MANAGER");
    expect(resolvePortal(roles(["ACCOUNTS"]))).toBe("ACCOUNTS");
    expect(resolvePortal(roles(["POS_MANAGER"]))).toBe("OUTLET");
    expect(resolvePortal(roles(["INVENTORY_MANAGER"]))).toBe("STORE");
    expect(resolvePortal(roles(["PURCHASE_MANAGER"]))).toBe("STORE");
    expect(resolvePortal(roles(["LAUNDRY_SUPERVISOR"]))).toBe("STORE");
    expect(resolvePortal(roles(["HOUSEKEEPING"]))).toBe("HOUSEKEEPING");
    expect(resolvePortal(roles(["MAINTENANCE"]))).toBe("MAINTENANCE");
    expect(resolvePortal(roles(["RECEPTION"]))).toBe("RECEPTION");
  });

  it("a multi-role user gets the highest-priority portal", () => {
    expect(resolvePortal(roles(["RECEPTION", "ADMINISTRATOR"]))).toBe("SUPER_ADMIN");
    expect(resolvePortal(roles(["HOUSEKEEPING", "MANAGER"]))).toBe("MANAGER");
  });

  it("returns null for an unmapped role or none", () => {
    expect(resolvePortal(roles(["SECURITY_SUPERVISOR"]))).toBeNull();
    expect(resolvePortal([])).toBeNull();
  });
});

describe("portalNavItems — role isolation", () => {
  it("reception sees front-desk modules, not manager/chain ones", () => {
    const k = keysFor(["RECEPTION"]);
    expect(k).toEqual(expect.arrayContaining(["bookings", "requests", "guests", "billing"]));
    expect(k).not.toContain("payroll");
    expect(k).not.toContain("channels");
    expect(k).not.toContain("users");
    expect(k).not.toContain("settings");
  });

  it("super admin sees chain + revenue modules, not front-desk ops", () => {
    const k = keysFor(["ADMINISTRATOR"]);
    expect(k).toEqual(expect.arrayContaining(["overview", "properties", "channels", "users"]));
    expect(k).not.toContain("housekeeping");
    expect(k).not.toContain("pos");
  });

  it("housekeeping sees only its console", () => {
    const k = keysFor(["HOUSEKEEPING"]);
    expect(k).toEqual(expect.arrayContaining(["housekeeping", "lost-found"]));
    expect(k).not.toContain("bookings");
    expect(k).not.toContain("billing");
  });

  it("outlet and store are distinct department portals", () => {
    expect(keysFor(["POS_MANAGER"])).toContain("pos");
    expect(keysFor(["INVENTORY_MANAGER"])).toContain("inventory");
    expect(keysFor(["POS_MANAGER"])).not.toContain("inventory");
  });

  it("preserves blueprint order (super admin: overview before channels before users)", () => {
    const k = keysFor(["ADMINISTRATOR"]);
    expect(k.indexOf("overview")).toBeLessThan(k.indexOf("channels"));
    expect(k.indexOf("channels")).toBeLessThan(k.indexOf("users"));
  });

  it("an unmapped role falls back to the permission-filtered flat nav (never empty)", () => {
    expect(keysFor(["SECURITY_SUPERVISOR"]).length).toBeGreaterThan(0);
  });

  it("never throws on empty permissions", () => {
    expect(() => portalNavItems(roles(["RECEPTION"]), [])).not.toThrow();
  });
});
