/**
 * Guest area shell (Phase 2). A light branded header shared by the auth pages and
 * the signed-in guest dashboard. Auth is NOT enforced here — the auth pages must
 * render for signed-out visitors; gated pages call `requireGuest()` themselves.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { resolveGuestSession, type GuestPrincipal } from "@/lib/guest-auth";
import { getGuestSummary } from "@/features/guest-account/queries";
import { GuestAccountMenu } from "@/features/guest-account/components/guest-account-menu";

export const dynamic = "force-dynamic";

export default async function AccountLayout({ children }: { children: ReactNode }) {
  const principal: GuestPrincipal | null = await resolveGuestSession();
  const summary = principal ? await getGuestSummary(principal) : null;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-4">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight text-primary">Woodpecker</span>
            <span className="hidden text-sm text-muted-foreground sm:inline">Apartments &amp; Suites</span>
          </Link>
          {summary ? (
            <GuestAccountMenu name={summary.fullName} />
          ) : (
            <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              ‹ Back to site
            </Link>
          )}
        </div>
      </header>
      {children}
    </div>
  );
}
