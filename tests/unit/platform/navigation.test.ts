/**
 * Traceability: 00 T-20 — FR-26, AC-24 ("nav renders only the caller's
 * permitted items").
 */
import { describe, expect, it } from "vitest";
import {
  BOTTOM_NAV_LIMIT,
  NAV_ITEMS,
  activeNavKey,
  bottomNavItems,
  overflowNavItems,
  visibleNavItems,
} from "@/features/platform/navigation";
import { PERMISSION_MAP } from "@/lib/permissions";

const admin = [...PERMISSION_MAP.ADMINISTRATOR];
const reception = [...PERMISSION_MAP.RECEPTION];
const housekeeping = [...PERMISSION_MAP.HOUSEKEEPING];
const accounts = [...PERMISSION_MAP.ACCOUNTS];

describe("visibleNavItems (AC-24)", () => {
  it("shows an administrator every item", () => {
    expect(visibleNavItems(admin)).toHaveLength(NAV_ITEMS.length);
  });

  it("hides user administration from Reception", () => {
    const keys = visibleNavItems(reception).map((i) => i.key);
    expect(keys).not.toContain("users");
    expect(keys).not.toContain("settings");
    expect(keys).toContain("bookings");
  });

  it("shows Housekeeping only operational items — no money, no guests", () => {
    const keys = visibleNavItems(housekeeping).map((i) => i.key);
    expect(keys).toContain("housekeeping");
    expect(keys).toContain("rooms");
    // user-roles.md: least privilege — never financials or guest PII.
    expect(keys).not.toContain("billing");
    expect(keys).not.toContain("reports");
    expect(keys).not.toContain("guests");
    expect(keys).not.toContain("expenses");
  });

  it("shows Accounts the financial items", () => {
    const keys = visibleNavItems(accounts).map((i) => i.key);
    expect(keys).toContain("billing");
    expect(keys).toContain("reports");
    expect(keys).toContain("expenses");
    expect(keys).not.toContain("users");
  });

  it("returns nothing for a user with no permissions — deny by default", () => {
    expect(visibleNavItems([])).toEqual([]);
  });

  it("every item's permission is a real permission from the matrix", () => {
    // Guards against a typo silently hiding an item from everyone forever.
    const all = new Set(admin);
    for (const item of NAV_ITEMS) {
      expect(all.has(item.permission), `${item.key} → ${item.permission}`).toBe(true);
    }
  });
});

describe("bottomNavItems (mobile-first.md — thumb-reachable)", () => {
  it("never exceeds the cap", () => {
    for (const perms of [admin, reception, accounts, housekeeping]) {
      expect(bottomNavItems(perms).length).toBeLessThanOrEqual(BOTTOM_NAV_LIMIT);
    }
  });

  it("orders primary items first, then fills any remaining slot", () => {
    // There are 4 primaries and 5 slots, so the last slot is legitimately a
    // non-primary — a half-empty bar would waste thumb space.
    const bar = bottomNavItems(admin);
    const firstNonPrimary = bar.findIndex((i) => !i.primary);
    const lastPrimary = bar.map((i) => Boolean(i.primary)).lastIndexOf(true);
    if (firstNonPrimary !== -1) expect(firstNonPrimary).toBeGreaterThan(lastPrimary);
    expect(bar.filter((i) => i.primary)).toHaveLength(
      NAV_ITEMS.filter((i) => i.primary).length,
    );
  });

  it("fills the bar with usable items for a low-privilege role", () => {
    // Housekeeping has few primaries; the bar should still not be near-empty
    // or padded with things they cannot open.
    const bar = bottomNavItems(housekeeping);
    expect(bar.length).toBeGreaterThan(0);
    const allowed = new Set(housekeeping);
    for (const item of bar) expect(allowed.has(item.permission)).toBe(true);
  });

  it("puts everything not on the bar into the overflow, with no duplicates", () => {
    const bar = bottomNavItems(admin).map((i) => i.key);
    const more = overflowNavItems(admin).map((i) => i.key);
    expect(new Set([...bar, ...more]).size).toBe(bar.length + more.length);
    expect([...bar, ...more].sort()).toEqual(visibleNavItems(admin).map((i) => i.key).sort());
  });
});

describe("activeNavKey", () => {
  it("matches the exact route", () => {
    expect(activeNavKey("/dashboard", admin)).toBe("dashboard");
  });

  it("matches a nested route", () => {
    expect(activeNavKey("/bookings/abc123", admin)).toBe("bookings");
  });

  it("prefers the longest prefix so a nested section wins", () => {
    // /settings/users must highlight Users, not Settings.
    expect(activeNavKey("/settings/users", admin)).toBe("users");
  });

  it("is null for an unknown route", () => {
    expect(activeNavKey("/nowhere", admin)).toBeNull();
  });

  it("never highlights an item the caller cannot see", () => {
    expect(activeNavKey("/settings/users", reception)).toBeNull();
  });
});
