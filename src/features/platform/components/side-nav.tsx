"use client";

/**
 * Tablet/desktop sidebar — the same permission-filtered items the phone bar
 * shows, enhanced upward per mobile-first.md ("use breakpoints to enhance
 * upward, never to fix a desktop-first layout downward").
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { NavItem } from "../navigation";
import { NavIcon } from "./nav-icon";

export function SideNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="hidden w-60 shrink-0 border-r bg-background md:block"
    >
      <ul className="space-y-1 p-3">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-touch items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <NavIcon name={item.icon} className="size-4" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
