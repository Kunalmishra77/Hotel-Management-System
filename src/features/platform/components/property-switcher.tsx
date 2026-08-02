"use client";

/**
 * Property switcher — 00 T-21 (FR-27, AC-25).
 *
 * AC-25: "a user with one property sees no switcher." Rendering a disabled
 * control for the single-property case would be noise on a phone top bar, so
 * this collapses to a plain label instead.
 */
import { useState, useTransition } from "react";
import { Building2, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { switchProperty } from "../actions";
import type { PropertyOption } from "../actions";

export function PropertySwitcher({
  properties,
  activePropertyId,
}: {
  properties: PropertyOption[];
  activePropertyId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const active = properties.find((p) => p.id === activePropertyId) ?? properties[0];
  if (!active) return null;

  // AC-25 — one property in scope means nothing to switch between.
  if (properties.length === 1) {
    return (
      <span className="flex min-h-touch items-center gap-2 px-2 text-sm font-medium">
        <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
        {active.name}
      </span>
    );
  }

  const choose = (id: string) => {
    if (id === active.id) {
      setOpen(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await switchProperty({ propertyId: id });
      if (!result.ok) setError(result.error.message);
      setOpen(false);
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Active property: ${active.name}. Change property.`}
        className={cn(
          "flex min-h-touch items-center gap-2 rounded-md px-2 text-sm font-medium",
          "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          pending && "opacity-60",
        )}
      >
        <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="max-w-[10rem] truncate">{active.name}</span>
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </button>

      {open && (
        <>
          {/* Tap-outside target; on a phone this is the whole screen. */}
          <div
            className="fixed inset-0 z-40"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <ul
            role="listbox"
            aria-label="Properties"
            className="absolute left-0 z-50 mt-1 min-w-[14rem] overflow-hidden rounded-md border bg-popover shadow-lg"
          >
            {properties.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={p.id === active.id}
                  onClick={() => choose(p.id)}
                  className={cn(
                    "flex min-h-touch w-full items-center justify-between gap-3 px-3 text-left text-sm",
                    "hover:bg-accent focus-visible:outline-none focus-visible:bg-accent",
                  )}
                >
                  <span className="truncate">
                    {p.name}
                    <span className="ml-2 text-xs text-muted-foreground">{p.code}</span>
                  </span>
                  {p.id === active.id && <Check className="size-4 shrink-0 text-primary" />}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {error && (
        <p role="alert" className="absolute left-0 top-full mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
