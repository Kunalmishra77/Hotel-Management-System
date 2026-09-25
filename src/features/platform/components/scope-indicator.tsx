"use client";
/**
 * Multi-property scope PICKER (super-admin / group).
 *
 * The client's rule: every page defaults to ALL HOTELS; picking a property scopes
 * the whole app to it, and "All hotels" clears back to the consolidated view. So
 * this is a real dropdown shown consistently on EVERY page — not a label that only
 * says "All hotels" on the command centre.
 *
 * Single-property users never see this — they keep the plain label in
 * PropertySwitcher.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronDown, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { switchProperty } from "../actions";
import type { PropertyOption } from "../actions";

export function ScopeIndicator({
  properties,
  activePropertyId,
}: {
  properties: PropertyOption[];
  activePropertyId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const active = properties.find((p) => p.id === activePropertyId) ?? null;

  const choose = (id: string | null) => {
    setOpen(false);
    if (id === activePropertyId) return;
    setError(null);
    startTransition(async () => {
      const result = await switchProperty({ propertyId: id });
      if (!result.ok) setError(result.error.message);
      else router.refresh();
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
        aria-label={active ? `Scope: ${active.name}. Change scope.` : "Scope: all hotels. Change scope."}
        className={cn(
          "flex min-h-touch items-center gap-2 rounded-md px-2 text-sm font-medium",
          "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          pending && "opacity-60",
        )}
      >
        {active ? (
          <>
            <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="max-w-[10rem] truncate">{active.name}</span>
          </>
        ) : (
          <>
            <Layers className="size-4 text-muted-foreground" aria-hidden="true" />
            All hotels
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
              {properties.length}
            </span>
          </>
        )}
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setOpen(false)} />
          <ul
            role="listbox"
            aria-label="Scope"
            className="absolute left-0 z-50 mt-1 min-w-[15rem] overflow-hidden rounded-md border bg-popover shadow-lg"
          >
            {/* All hotels — the default, consolidated scope. */}
            <li>
              <button
                type="button"
                role="option"
                aria-selected={active === null}
                onClick={() => choose(null)}
                className={cn(
                  "flex min-h-touch w-full items-center justify-between gap-3 px-3 text-left text-sm",
                  "hover:bg-accent focus-visible:outline-none focus-visible:bg-accent",
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  <Layers className="size-4 text-muted-foreground" aria-hidden="true" />
                  All hotels
                  <span className="text-xs text-muted-foreground">({properties.length})</span>
                </span>
                {active === null && <Check className="size-4 shrink-0 text-primary" />}
              </button>
            </li>
            <li aria-hidden="true" className="my-1 border-t" />
            {properties.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={p.id === activePropertyId}
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
                  {p.id === activePropertyId && <Check className="size-4 shrink-0 text-primary" />}
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
