/**
 * The authenticated app shell — 00 T-20/T-21 (FR-26/FR-27, AC-24/AC-25).
 *
 * design.md § App shell (phone): "top bar = property switcher + user menu;
 * bottom tab bar = permission-filtered".
 *
 * A Server Component: nav items and property options are computed from the
 * server-resolved session, so a user's permissions never travel to the browser
 * and cannot be tampered with there.
 */
import { UserMenu } from "@/components/layout/user-menu";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import type { SessionClaims } from "@/lib/auth/claims";
import type { PropertyOption } from "../actions";
import { portalNavItems, portalBottomNavItems } from "../portals";
import { BottomNav } from "./bottom-nav";
import { CommandPalette } from "./command-palette";
import { PropertySwitcher } from "./property-switcher";
import { ScopeIndicator } from "./scope-indicator";
import { SideNav } from "./side-nav";

export function AppShell({
  claims,
  properties,
  children,
}: {
  claims: SessionClaims;
  properties: PropertyOption[];
  children: React.ReactNode;
}) {
  // Architecture v2 · Phase 1 — role-scoped portal nav: each role sees only its
  // own portal's modules, in blueprint order (still permission-gated underneath).
  const roles = claims.roleAssignments.map((r) => r.role);
  const sideItems = portalNavItems(roles, claims.resolvedPermissions);
  const barItems = portalBottomNavItems(roles, claims.resolvedPermissions);

  return (
    // h-dvh (not min-h) so the sidebar and main scroll INDEPENDENTLY inside a
    // fixed viewport — the left nav no longer scrolls away with the content.
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="z-30 flex min-h-touch shrink-0 items-center justify-between gap-2 border-b bg-background px-2 pt-[env(safe-area-inset-top)]">
        {properties.length > 1 ? (
          // Multi-property (super-admin / group): no "switch to a hotel" dropdown —
          // default is ALL hotels; drill-in from the command centre, ◀ back from anywhere.
          <ScopeIndicator properties={properties} activePropertyId={claims.activePropertyId} />
        ) : (
          <PropertySwitcher properties={properties} activePropertyId={claims.activePropertyId} />
        )}

        <div className="flex items-center gap-1.5">
          <CommandPalette navItems={sideItems.map((i) => ({ key: i.key, label: i.label, href: i.href, icon: i.icon }))} />
          <NotificationBell />
          <ThemeToggle />
          <UserMenu name={claims.name} email={claims.email} />
        </div>
      </header>

      {/* min-h-0 lets the flex children actually scroll instead of growing. */}
      <div className="flex min-h-0 flex-1">
        <SideNav items={sideItems} />
        <main
          id="main"
          className="min-w-0 flex-1 overflow-y-auto px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+4.5rem)] md:pb-6"
        >
          {children}
        </main>
      </div>

      <BottomNav items={barItems} />
    </div>
  );
}
