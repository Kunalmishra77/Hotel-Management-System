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

/** Role → portal, highest privilege first; the first match wins for a multi-role user. */
const ROLE_PORTAL_PRIORITY: readonly { role: RoleName; portal: PortalId }[] = [
  { role: "ADMINISTRATOR", portal: "SUPER_ADMIN" },
  { role: "OWNER", portal: "OWNER" },
  { role: "MANAGER", portal: "MANAGER" },
  { role: "ASSISTANT_MANAGER", portal: "MANAGER" },
  { role: "ACCOUNTS", portal: "ACCOUNTS" },
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
  // Chain-owner command centre. Revenue & Distribution = channels + pricing + corporate + booking-site.
  SUPER_ADMIN: [
    "overview", "insights", "properties", "approvals", "reports",
    "channels", "pricing", "corporate", "booking-site",
    "communications", "users", "accounting", "data-import", "settings", "ai",
  ],
  // Read-mostly property-owner portal (merges into Super Admin in a later phase).
  OWNER: ["owner", "owner-documents", "owner-schedule", "owner-payouts"],
  // Single-hotel operations control centre.
  MANAGER: [
    "dashboard", "operations", "rooms", "bookings", "in-house", "guests",
    "housekeeping", "maintenance", "inventory", "laundry",
    "billing", "approvals", "expenses", "payroll", "staff", "field-staff",
    "feedback", "requests", "reports", "communications", "ai",
  ],
  // Front-desk operations console. (Search is the header command palette, not a page.)
  RECEPTION: [
    "dashboard", "rooms", "bookings", "in-house", "guests",
    "requests", "add-ons", "billing",
    "housekeeping", "maintenance", "form-c", "ai",
  ],
  // Finance console.
  ACCOUNTS: ["overview", "billing", "expenses", "payroll", "accounting", "corporate", "reports", "ai"],
  // Room-readiness console.
  HOUSEKEEPING: ["dashboard", "housekeeping", "lost-found", "inventory", "laundry", "ai"],
  // Technical operations console.
  MAINTENANCE: ["dashboard", "maintenance", "ai"],
  // F&B / room-service outlet.
  OUTLET: ["dashboard", "pos", "ai"],
  // Store · purchase · laundry.
  STORE: ["dashboard", "inventory", "laundry", "reports", "ai"],
};

const NAV_BY_KEY = new Map(NAV_ITEMS.map((i) => [i.key, i]));

/** The caller's portal, or null when no role maps to one (→ fall back to flat nav). */
export function resolvePortal(roles: readonly RoleName[]): PortalId | null {
  const held = new Set(roles);
  for (const { role, portal } of ROLE_PORTAL_PRIORITY) {
    if (held.has(role)) return portal;
  }
  return null;
}

/** Role-scoped, blueprint-ordered nav for the caller's portal ∩ held permissions. */
export function portalNavItems(roles: readonly RoleName[], permissions: readonly Permission[]): NavItem[] {
  const held = new Set(permissions);
  const portal = resolvePortal(roles);
  if (!portal) return NAV_ITEMS.filter((i) => held.has(i.permission));

  const items: NavItem[] = [];
  for (const key of PORTAL_NAV[portal]) {
    const item = NAV_BY_KEY.get(key);
    if (item && held.has(item.permission)) items.push(item);
  }
  // Never strand a user with an empty rail (e.g. permissions narrower than the portal list).
  return items.length > 0 ? items : NAV_ITEMS.filter((i) => held.has(i.permission));
}

/** The phone bottom bar for the caller's portal — primary items first, capped. */
export function portalBottomNavItems(roles: readonly RoleName[], permissions: readonly Permission[]): NavItem[] {
  const items = portalNavItems(roles, permissions);
  const primary = items.filter((i) => i.primary);
  const rest = items.filter((i) => !i.primary);
  return [...primary, ...rest].slice(0, BOTTOM_NAV_LIMIT);
}
