"use client";
/**
 * Guest account menu — shows the signed-in name and a sign-out control (Phase 2).
 * Sign-out revokes the session server-side, then returns to the customer home.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logOutGuest } from "../actions";

export function GuestAccountMenu({ name }: { name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function signOut() {
    startTransition(async () => {
      await logOutGuest();
      router.replace("/");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:inline-flex">
        <UserRound className="size-4" aria-hidden="true" />
        {name}
      </span>
      <Button variant="ghost" size="sm" onClick={signOut} disabled={pending}>
        <LogOut className="size-4" aria-hidden="true" />
        {pending ? "Signing out…" : "Sign out"}
      </Button>
    </div>
  );
}
