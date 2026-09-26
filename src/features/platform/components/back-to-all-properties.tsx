"use client";

/**
 * "← All properties" — clears the single-property focus (switchProperty → null) and
 * returns the page to its all-hotels view. Used on per-property pages that were
 * drilled into from the property chooser / header selector.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { switchProperty } from "../actions";

export function BackToAllProperties({ label = "All properties" }: { label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => { await switchProperty({ propertyId: null }); router.refresh(); })}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      data-testid="back-to-all-properties"
    >
      <ChevronLeft className="size-4" aria-hidden="true" /> {pending ? "…" : label}
    </button>
  );
}
