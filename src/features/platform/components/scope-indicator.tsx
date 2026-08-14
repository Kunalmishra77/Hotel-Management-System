"use client";
/**
 * Multi-property scope indicator (super-admin redesign). Replaces the property
 * SWITCHER for users who span more than one hotel: there is no "jump to an
 * arbitrary hotel" dropdown. Instead the default is ALL HOTELS (the command
 * centre); drilling into one hotel from there shows its name here with a clear
 * "◀ All hotels" way back to the consolidated view.
 *
 * Single-property users never see this — they keep the plain label in
 * PropertySwitcher.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, ChevronLeft } from "lucide-react";
import type { PropertyOption } from "../actions";

const ALL_HOTELS_HREF = "/overview";

export function ScopeIndicator({
  properties,
  activePropertyId,
}: {
  properties: PropertyOption[];
  activePropertyId: string | null;
}) {
  const pathname = usePathname();
  const onCommandCentre = pathname === ALL_HOTELS_HREF;
  const active = properties.find((p) => p.id === activePropertyId) ?? null;

  // On the command centre (or with nothing focused): show the consolidated label.
  if (onCommandCentre || !active) {
    return (
      <span className="flex min-h-touch items-center gap-2 px-2 text-sm font-medium">
        <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
        All hotels
        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
          {properties.length}
        </span>
      </span>
    );
  }

  // Focused on one hotel — name it, and offer the way back to all hotels.
  return (
    <div className="flex min-h-touch items-center gap-1 px-1 text-sm">
      <Link
        href={ALL_HOTELS_HREF}
        aria-label="Back to all hotels"
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="size-4" aria-hidden="true" /> All hotels
      </Link>
      <span className="mx-0.5 text-muted-foreground/40" aria-hidden="true">
        /
      </span>
      <span className="flex items-center gap-1.5 font-medium">
        <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="max-w-[9rem] truncate">{active.name}</span>
      </span>
    </div>
  );
}
