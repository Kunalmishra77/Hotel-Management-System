"use client";

/**
 * Tablet/desktop sidebar — the same permission-filtered items the phone bar
 * shows, enhanced upward per mobile-first.md ("use breakpoints to enhance
 * upward, never to fix a desktop-first layout downward").
 *
 * While the PMS Agent panel is docked on the right (#pms-agent-panel present),
 * the sidebar folds to an icon rail so the page keeps nearly its full width —
 * pages are laid out for that width and broke when squeezed (13 Nov 2026).
 * Pure CSS (`:has()`), so no state is shared between the two components.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { NavItem } from "../navigation";
import { NavIcon } from "./nav-icon";

export function SideNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  // `[body:has(#pms-agent-panel)_&]:…` = "while the docked agent panel is on the page".

  return (
    <nav
      aria-label="Primary"
      className={cn("hidden w-60 shrink-0 overflow-y-auto border-r bg-background transition-[width] md:block", "[body:has(#pms-agent-panel)_&]:w-16")}
    >
      <ul className={cn("space-y-1 p-3", "[body:has(#pms-agent-panel)_&]:px-2")}>
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={item.label}
                className={cn(
                  "flex min-h-touch items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                  "[body:has(#pms-agent-panel)_&]:justify-center [body:has(#pms-agent-panel)_&]:px-0",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <NavIcon name={item.icon} className="size-4 shrink-0" />
                <span className="[body:has(#pms-agent-panel)_&]:sr-only">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
