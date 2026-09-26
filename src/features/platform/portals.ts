/**
 * Role → Portal navigation (architecture v2 · Phase 1).
 *
 * The blueprint's core rule: every role sees ONLY its own portal's modules, in a
 * deliberate order — not one flat permission-filtered list. This maps each role to
 * a portal and each portal to its ordered module set.
 *
 * Two safety nets keep this cosmetic-only (authorization still lives server-side):
 *  1. Every portal list is intersected with the caller's held permissions, so a
 *     portal can never surface something the user isn't actually allowed to open.
 *  2. A role with no portal mapping falls back to the permission-filtered flat nav.
 *
 * Only EXISTING routes appear here; new modules from the blueprint (Operations
 * Center, In-House Guests, Portfolio Insights, Room Inspection, Assets…) are added
 * to a portal's list as each is built in later phases.
 */
import type { RoleName } from "@prisma/client";
import type { Permission } from "@/lib/permissions";
import { NAV_ITEMS, type NavItem, BOTTOM_NAV_LIMIT } from "./navigation";

export type PortalId =
  | "SUPER_ADMIN"
  | "OWNER"
  | "MANAGER"
  | "RECEPTION"
  | "ACCOUNTS"
  | "HOUSEKEEPING"
  | "MAINTENANCE"
  | "OUTLET"
  | "STORE";

/**
 * Role → portal, highest privilege first; the first match wins for a multi-role user.
 *
 * Client directive (Sep 2026): there is ONE manager who runs the whole business
 * from a SINGLE portal that has everything A-to-Z — the client does not want
 * separate staff portals. So every business-running role (Administrator, Manager,
 * Assistant-Manager, Accounts) lands on the one comprehensive SUPER_ADMIN portal.
 * These four all hold `report:view-financial`, so the portal's financial home
 * (/overview) and portfolio billing/bookings views work for each of them.
 *
 * Two exceptions, deliberately kept:
 *  - OWNER is an EXTERNAL property-owner audience (read-only financials, MoM
 *    2026-08-03) — not a staff portal; it stays its own thing.
 *  - The narrow specialist consoles (Reception/Housekeeping/Maintenance/Outlet/
 *    Store) remain for their low-privilege roles: those roles lack
 *    `report:view-financial`, so routing them to SUPER_ADMIN (whose home redirects
 *    to /overview) would strand them. The client won't use these logins; they do
 *    no harm left in place.
 */
const ROLE_PORTAL_PRIORITY: readonly { role: RoleName; portal: PortalId }[] = [
  { role: "ADMINISTRATOR", portal: "SUPER_ADMIN" },
  { role: "OWNER", portal: "OWNER" },
  { role: "MANAGER", portal: "SUPER_ADMIN" },
  { role: "ASSISTANT_MANAGER", portal: "SUPER_ADMIN" },
  { role: "ACCOUNTS", portal: "SUPER_ADMIN" },
  { role: "POS_MANAGER", portal: "OUTLET" },
  { role: "INVENTORY_MANAGER", portal: "STORE" },
  { role: "PURCHASE_MANAGER", portal: "STORE" },
  { role: "LAUNDRY_SUPERVISOR", portal: "STORE" },
  { role: "HOUSEKEEPING", portal: "HOUSEKEEPING" },
  { role: "MAINTENANCE", portal: "MAINTENANCE" },
  { role: "RECEPTION", portal: "RECEPTION" },
];

/** Portal → ordered nav keys (blueprint order; existing routes only). */
const PORTAL_NAV: Record<PortalId, readonly string[]> = {
  // THE single, comprehensive workspace (client req #17–20 + Phase-3 simplification):
  // one manager runs the whole business from here. Trimmed to the modules this client
  // actually uses (Phase-3 decisions, 26 Sep 2026) — removed: POS, kitchen, inventory,
  // laundry, accounting-sync, corporate, field-staff, portfolio-insights, guest-
  // requests, guest-messages, add-ons, approvals, room-inspection, assets; hidden:
  // channels, booking-site (until OTA/booking-engine go live). Merges (gst-claims →
  // Billing tab, staff+payroll → People, data-entry+import → Import/Export, messages →
  // Communications) land in their own module steps. Intersected with held permissions.
  SUPER_ADMIN: [
    // Command
    "overview",
    // Front desk & guests
    "bookings", "in-house", "rooms", "guests", "form-c", "feedback",
    // Money (GST claims is a tab inside Billing now)
    "billing", "expenses", "reports", "pricing",
    // Rooms readiness & upkeep
    "housekeeping", "maintenance", "lost-found",
    // People
    "staff", "payroll",
    // Property & configuration
    "properties", "communications", "ai", "data-import", "data-entry", "users", "settings",
  ],
  // Read-mostly property-owner portal (merges into Super Admin in a later phase).
  OWNER: ["owner", "owner-documents", "owner-schedule", "owner-payouts"],
  // Single-hotel operations control centre.
  MANAGER: [
    "dashboard", "operations", "rooms", "bookings", "in-house", "guests",
    "housekeeping", "maintenance", "inventory", "laundry",
    "finance", "staff", "field-staff",
    "guest-experience", "requests", "messages", "reports", "communications",
  ],
  // Front-desk operations console. (Search is the header command palette, not a page.)
  RECEPTION: [
    "dashboard", "rooms", "bookings", "in-house", "guests",
    "requests", "messages", "add-ons", "billing",
    "housekeeping", "maintenance", "form-c",
  ],
  // Finance console.
  ACCOUNTS: ["overview", "billing", "expenses", "payroll", "accounting", "corporate", "reports"],
  // Room-readiness console.
  HOUSEKEEPING: ["dashboard", "housekeeping", "inspection", "lost-found", "inventory", "laundry"],
  // Technical operations console.
  MAINTENANCE: ["dashboard", "maintenance", "assets"],
  // F&B / room-service outlet.
  OUTLET: ["dashboard", "pos", "kitchen"],
  // Store · purchase · laundry.
  STORE: ["dashboard", "inventory", "laundry", "reports"],
};

const NAV_BY_KEY = new Map(NAV_ITEMS.map((i) => [i.key, i]));

/**
 * Nav keys that require a paid add-on module (architecture v2 · SaaS feature-gating).
 * A nav entry here is hidden unless the org's plan includes the module. Everything
 * not listed is part of the Core plan and always available.
 */
const NAV_MODULE_REQUIREMENT: Record<string, string> = {
  channels: "channel-manager",
  "booking-site": "booking-engine",
  owner: "owner-portal",
  "owner-documents": "owner-portal",
  "owner-schedule": "owner-portal",
  "owner-payouts": "owner-portal",
  ai: "ai",
};

/** The caller's portal, or null when no role maps to one (→ fall back to flat nav). */
export function resolvePortal(roles: readonly RoleName[]): PortalId | null {
  const held = new Set(roles);
  for (const { role, portal } of ROLE_PORTAL_PRIORITY) {
    if (held.has(role)) return portal;
  }
  return null;
}

/** True when a nav key is available given the org's enabled add-on modules. When
 *  `enabledModules` is undefined, no gating is applied (backward-compatible). */
function moduleAllowed(key: string, enabledModules?: readonly string[]): boolean {
  if (!enabledModules) return true;
  const req = NAV_MODULE_REQUIREMENT[key];
  return req ? enabledModules.includes(req) : true;
}

/** Role-scoped, blueprint-ordered nav for the caller's portal ∩ held permissions,
 *  ∩ the org's plan modules (SaaS feature-gating). */
export function portalNavItems(
  roles: readonly RoleName[],
  permissions: readonly Permission[],
  enabledModules?: readonly string[],
): NavItem[] {
  const held = new Set(permissions);
  const gate = (i: NavItem) => held.has(i.permission) && moduleAllowed(i.key, enabledModules);
  const portal = resolvePortal(roles);
  if (!portal) return NAV_ITEMS.filter(gate);

  const items: NavItem[] = [];
  for (const key of PORTAL_NAV[portal]) {
    const item = NAV_BY_KEY.get(key);
    if (item && gate(item)) items.push(item);
  }
  // Never strand a user with an empty rail (e.g. permissions narrower than the portal list).
  return items.length > 0 ? items : NAV_ITEMS.filter(gate);
}

/** The phone bottom bar for the caller's portal — primary items first, capped. */
export function portalBottomNavItems(
  roles: readonly RoleName[],
  permissions: readonly Permission[],
  enabledModules?: readonly string[],
): NavItem[] {
  const items = portalNavItems(roles, permissions, enabledModules);
  const primary = items.filter((i) => i.primary);
  const rest = items.filter((i) => !i.primary);
  return [...primary, ...rest].slice(0, BOTTOM_NAV_LIMIT);
}
