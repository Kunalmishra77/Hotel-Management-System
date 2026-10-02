"use client";

/**
 * Global "Back" affordance in the app header — present on every page so staff can
 * always step back after any action, on phone or desktop. Hidden on the portal
 * home screens (nothing to go back to). Uses browser history (router.back()).
 */
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

// Portal landing pages — no "back" shown here.
const HOME_ROUTES = new Set(["/", "/dashboard", "/overview", "/owner"]);

export function BackButton() {
  const pathname = usePathname();
  const router = useRouter();
  if (HOME_ROUTES.has(pathname)) return null;
  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="Go back"
      className="inline-flex min-h-touch items-center gap-1 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      data-testid="back-button"
    >
      <ChevronLeft className="size-4" />
      <span className="hidden sm:inline">Back</span>
    </button>
  );
}
