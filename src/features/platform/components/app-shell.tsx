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
import { signOutAction } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import type { SessionClaims } from "@/lib/auth/claims";
import type { PropertyOption } from "../actions";
import { bottomNavItems, visibleNavItems } from "../navigation";
import { BottomNav } from "./bottom-nav";
import { PropertySwitcher } from "./property-switcher";
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
  const sideItems = visibleNavItems(claims.resolvedPermissions);
  const barItems = bottomNavItems(claims.resolvedPermissions);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex min-h-touch items-center justify-between gap-2 border-b bg-background px-2 pt-[env(safe-area-inset-top)]">
        <PropertySwitcher properties={properties} activePropertyId={claims.activePropertyId} />

        <div className="flex items-center gap-2">
          <span className="hidden text-sm text-muted-foreground sm:inline">{claims.name}</span>
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <div className="flex flex-1">
        <SideNav items={sideItems} />
        <main
          id="main"
          className="min-w-0 flex-1 px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+4.5rem)] md:pb-6"
        >
          {children}
        </main>
      </div>

      <BottomNav items={barItems} />
    </div>
  );
}
