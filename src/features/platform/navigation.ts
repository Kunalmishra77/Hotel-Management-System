/**
 * The app-shell navigation model — 00 T-20 (FR-26, AC-24).
 *
 * "renders navigation filtered to the caller's permissions."
 *
 * Each item declares the permission that gates it, so nav and authorization can
 * never drift: an item appears only if the caller actually holds the permission
 * the target route enforces. Hiding is cosmetic — the server re-checks
 * (security.md) — but a link a user cannot follow is still a bug.
 *
 * Pure data + a pure filter, so it is unit-testable without rendering.
 */
import type { Permission } from "@/lib/permissions";

export type NavItem = {
  key: string;
  label: string;
  href: string;
  /** Lucide icon name, resolved in the component layer. */
  icon: string;
  permission: Permission;
  /** Shown in the phone bottom bar (mobile-first.md), max ~5. */
  primary?: boolean;
};

/**
 * Every destination the shell can offer. Every entry resolves to a real, built
 * page that enforces its declared permission server-side via `requirePermission`
 * (AC-24) — so a hidden item is not merely hidden, and there are no placeholder
 * destinations left in the shell.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    icon: "LayoutDashboard",
    permission: "report:view-operational",
    primary: true,
  },
  {
    // 27 owner-portal — property owner's home (financials for their property).
    key: "owner",
    label: "Owner portal",
    href: "/owner",
    icon: "House",
    permission: "owner:view-financials",
    primary: true,
  },
  {
    key: "owner-documents",
    label: "Documents",
    href: "/owner/documents",
    icon: "FolderLock",
    permission: "owner:view-docs",
  },
  {
    key: "owner-schedule",
    label: "Schedule",
    href: "/owner/schedule",
    icon: "CalendarClock",
    permission: "owner:view-schedule",
  },
  {
    key: "owner-payouts",
    label: "Payouts",
    href: "/owner/payouts",
    icon: "Coins",
    permission: "owner:view-payout",
  },
  {
    // Manager/Accounts analytics home — consolidated KPIs, revenue trend, and
    // revenue segmentation across all accessible properties (financial-gated).
    key: "overview",
    label: "Command centre",
    href: "/overview",
    icon: "Gauge",
    permission: "report:view-financial",
    primary: true,
  },
  {
    key: "properties",
    label: "Properties",
    href: "/properties",
    icon: "Building2",
    // Every role that sees rooms sees the property list; the list itself is
    // scoped to their assignments (01 FR-8), so this is not a leak.
    permission: "room:view-status",
    primary: true,
  },
  {
    key: "rooms",
    label: "Rooms",
    href: "/rooms",
    icon: "BedDouble",
    permission: "room:view-status",
    primary: true,
  },
  {
    key: "bookings",
    label: "Bookings",
    href: "/bookings",
    icon: "CalendarDays",
    permission: "reservation:view",
    primary: true,
  },
  {
    key: "guests",
    label: "Guests",
    href: "/guests",
    icon: "Users",
    permission: "guest:view",
    primary: true,
  },
  {
    key: "requests",
    label: "Guest requests",
    href: "/requests",
    icon: "ConciergeBell",
    permission: "request:manage",
  },
  {
    // FRRO Form C register for foreign-guest arrivals (03 FR-25/26). Same
    // permission as the bookings board; the register itself never exposes ID numbers.
    key: "form-c",
    label: "Form C",
    href: "/bookings/form-c",
    icon: "FileCheck2",
    permission: "reservation:view",
  },
  {
    // 18/05 — guest feedback & reviews with AI sentiment (property-scoped).
    key: "feedback",
    label: "Feedback",
    href: "/feedback",
    icon: "MessageSquareHeart",
    permission: "guest:view",
  },
  {
    key: "search",
    label: "Search",
    href: "/search",
    icon: "Search",
    // Unified search re-checks per-entity permission server-side (15 FR-3/6); the
    // nav entry is gated on the most common searcher permission. Roles without it
    // can still reach /search directly and see only what they're permitted to.
    permission: "guest:view",
  },
  {
    key: "housekeeping",
    label: "Housekeeping",
    href: "/housekeeping",
    icon: "Sparkles",
    permission: "housekeeping:update",
  },
  {
    key: "lost-found",
    label: "Lost & Found",
    href: "/lost-found",
    icon: "PackageSearch",
    permission: "housekeeping:update",
  },
  {
    key: "maintenance",
    label: "Maintenance",
    href: "/maintenance",
    icon: "Wrench",
    permission: "maintenance:manage",
  },
  {
    key: "billing",
    label: "Billing",
    href: "/billing",
    icon: "Receipt",
    permission: "folio:view",
  },
  {
    key: "expenses",
    label: "Expenses",
    href: "/expenses",
    icon: "Wallet",
    permission: "expense:create",
  },
  {
    key: "pos",
    label: "POS",
    href: "/pos",
    icon: "UtensilsCrossed",
    permission: "pos:order-create",
  },
  {
    key: "inventory",
    label: "Inventory",
    href: "/inventory",
    icon: "Package",
    permission: "inventory:manage",
  },
  {
    // 20 addendum — laundry linen reconciliation (LAUNDRY_SUPERVISOR + managers).
    key: "laundry",
    label: "Laundry",
    href: "/inventory/laundry",
    icon: "Shirt",
    permission: "inventory:manage",
  },
  {
    key: "payroll",
    label: "Payroll",
    href: "/payroll",
    icon: "Banknote",
    permission: "payroll:run",
  },
  {
    key: "accounting",
    label: "Accounting sync",
    href: "/accounting",
    icon: "Landmark",
    permission: "integration:manage",
  },
  {
    key: "corporate",
    label: "Corporate",
    href: "/corporate",
    icon: "Briefcase",
    permission: "corporate:manage",
  },
  {
    key: "data-import",
    label: "Data import",
    href: "/data-import",
    icon: "Upload",
    permission: "data:import",
  },
  {
    key: "communications",
    label: "Communications",
    href: "/communications",
    icon: "MessageSquare",
    permission: "communication:send",
  },
  {
    key: "ai",
    label: "AI Assistant",
    href: "/ai",
    icon: "Bot",
    permission: "ai:use",
  },
  {
    key: "pricing",
    label: "Pricing",
    href: "/pricing",
    icon: "TrendingUp",
    permission: "pricing:approve",
  },
  {
    key: "channels",
    label: "Channels",
    href: "/channels",
    icon: "Cable",
    permission: "integration:manage",
  },
  {
    key: "booking-site",
    label: "Booking site",
    href: "/booking-site",
    icon: "Globe",
    permission: "bookingengine:manage",
  },
  {
    key: "reports",
    label: "Reports",
    href: "/reports",
    icon: "ChartColumn",
    permission: "report:view-financial",
  },
  {
    key: "staff",
    label: "Staff",
    href: "/staff",
    icon: "IdCard",
    // MoM: reception logs attendance/salary, so the screen is reachable with the
    // narrow attendance permission; full staff CRUD inside stays staff:manage-gated.
    permission: "attendance:record",
  },
  {
    // 09 addendum — field-staff live locations (MoM line 32). staff:manage.
    key: "field-staff",
    label: "Field staff",
    href: "/staff/field",
    icon: "Navigation",
    permission: "staff:manage",
  },
  {
    key: "settings",
    label: "Settings",
    href: "/settings",
    icon: "Settings",
    permission: "settings:manage",
  },
  {
    key: "users",
    label: "Users & Access",
    href: "/settings/users",
    icon: "ShieldCheck",
    permission: "user:manage",
  },
];

/** Items the caller may actually reach. */
export function visibleNavItems(permissions: readonly Permission[]): NavItem[] {
  const held = new Set(permissions);
  return NAV_ITEMS.filter((item) => held.has(item.permission));
}

/**
 * The phone bottom bar: the caller's primary items, capped at 5.
 *
 * mobile-first.md — a bottom bar wider than five targets stops being
 * thumb-reachable. Anything beyond the cap stays in the "More" sheet, so a
 * low-privilege user (housekeeping) still gets a full bar of things they can
 * actually do rather than a bar of disabled stubs.
 */
export const BOTTOM_NAV_LIMIT = 5;

export function bottomNavItems(permissions: readonly Permission[]): NavItem[] {
  const visible = visibleNavItems(permissions);
  const primary = visible.filter((i) => i.primary);
  const rest = visible.filter((i) => !i.primary);
  return [...primary, ...rest].slice(0, BOTTOM_NAV_LIMIT);
}

/** Items not on the bottom bar — the "More" sheet. */
export function overflowNavItems(permissions: readonly Permission[]): NavItem[] {
  const shown = new Set(bottomNavItems(permissions).map((i) => i.key));
  return visibleNavItems(permissions).filter((i) => !shown.has(i.key));
}

/** Longest-prefix match so /settings/users highlights Users, not Settings. */
export function activeNavKey(pathname: string, permissions: readonly Permission[]): string | null {
  const candidates = visibleNavItems(permissions)
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length);
  return candidates[0]?.key ?? null;
}
