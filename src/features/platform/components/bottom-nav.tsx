"use client";

/**
 * Phone bottom tab bar — 00 T-20 (FR-26, AC-24), mobile-first.md.
 *
 * "bottom tab bar = permission-filtered (Dashboard, Bookings, Guests, more…)"
 * — specs/00-platform/design.md § App shell (phone).
 *
 * Client component only because it needs the active pathname. The item list is
 * computed on the server and passed in, so a user's permissions never round-trip
 * through the browser.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { NavItem } from "../navigation";
import { NavIcon } from "./nav-icon";

export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  if (items.length === 0) return null;

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t bg-background",
        // Respect the iOS home-indicator inset so the last row stays tappable.
        "pb-[env(safe-area-inset-bottom)]",
        "md:hidden",
      )}
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-touch flex-col items-center justify-center gap-1 px-1 py-2 text-xs",
                  "transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <NavIcon name={item.icon} className="size-5" />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
