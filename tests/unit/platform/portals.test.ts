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
  it("routes every business-running role to the ONE portal (client req #17-20)", () => {
    // Client directive: a single manager runs everything from one A-to-Z portal.
    expect(resolvePortal(roles(["ADMINISTRATOR"]))).toBe("SUPER_ADMIN");
    expect(resolvePortal(roles(["MANAGER"]))).toBe("SUPER_ADMIN");
    expect(resolvePortal(roles(["ASSISTANT_MANAGER"]))).toBe("SUPER_ADMIN");
    expect(resolvePortal(roles(["ACCOUNTS"]))).toBe("SUPER_ADMIN");
  });

  it("keeps OWNER (external property owner) separate — not a staff portal", () => {
    expect(resolvePortal(roles(["OWNER"]))).toBe("OWNER");
  });

  it("keeps the narrow specialist consoles for their low-privilege roles", () => {
    // These roles lack report:view-financial; the single portal's home redirects to
    // /overview, so they retain their own console instead of being stranded.
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
    expect(resolvePortal(roles(["HOUSEKEEPING", "MANAGER"]))).toBe("SUPER_ADMIN");
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

  it("the single portal has the Phase-3 trimmed module set (client req #17-20 + simplification)", () => {
    const k = keysFor(["ADMINISTRATOR"]);
    // The lean set the client actually uses.
    expect(k).toEqual(expect.arrayContaining([
      "overview", "bookings", "in-house", "rooms", "guests", "form-c", "feedback",
      "billing", "gst-claims", "expenses", "reports", "pricing",
      "housekeeping", "maintenance", "lost-found",
      "staff", "payroll",
      "properties", "communications", "ai", "data-import", "data-entry", "users", "settings",
    ]));
    // Removed / hidden in Phase 3 — must NOT appear.
    for (const gone of ["insights", "requests", "messages", "add-ons", "accounting", "corporate", "approvals", "inspection", "assets", "pos", "kitchen", "inventory", "laundry", "field-staff", "channels", "booking-site"]) {
      expect(k).not.toContain(gone);
    }
  });

  it("a Manager account also gets the one comprehensive portal", () => {
    // The client's single manager may hold MANAGER (not ADMINISTRATOR) — either way,
    // one A-to-Z portal (intersected with permissions).
    const k = keysFor(["MANAGER"]);
    expect(k).toEqual(expect.arrayContaining(["bookings", "billing", "expenses", "reports", "housekeeping"]));
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

  it("preserves nav order (super admin: overview before billing before users)", () => {
    const k = keysFor(["ADMINISTRATOR"]);
    expect(k.indexOf("overview")).toBeLessThan(k.indexOf("billing"));
    expect(k.indexOf("billing")).toBeLessThan(k.indexOf("users"));
  });

  it("an unmapped role falls back to the permission-filtered flat nav (never empty)", () => {
    expect(keysFor(["SECURITY_SUPERVISOR"]).length).toBeGreaterThan(0);
  });

  it("never throws on empty permissions", () => {
    expect(() => portalNavItems(roles(["RECEPTION"]), [])).not.toThrow();
  });
});

describe("portalNavItems — Phase-3 hidden modules + SaaS plan gating", () => {
  const adminKeys = (mods?: string[]) => portalNavItems(roles(["ADMINISTRATOR"]), ALL_PERMS, mods).map((i) => i.key);

  it("channels + booking-site are hidden from the admin nav regardless of plan (Phase-3)", () => {
    // Removed from the SUPER_ADMIN nav until OTA / booking-engine go live.
    for (const mods of [undefined, [], ["channel-manager", "booking-engine"]] as (string[] | undefined)[]) {
      const k = adminKeys(mods);
      expect(k).not.toContain("channels");
      expect(k).not.toContain("booking-site");
    }
  });

  it("ai is plan-gated: hidden on Core, shown when the ai module is enabled", () => {
    expect(adminKeys([])).not.toContain("ai");
    expect(adminKeys(["ai"])).toContain("ai");
    expect(adminKeys(undefined)).toContain("ai"); // undefined = no gating
  });

  it("core modules are always present", () => {
    const k = adminKeys([]);
    expect(k).toContain("overview");
    expect(k).toContain("users");
    expect(k).toContain("billing");
  });
});
