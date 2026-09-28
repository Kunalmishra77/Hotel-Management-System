"use client";

/**
 * Check-out from the booking page (03 lifecycle) — the correct action for an
 * IN_HOUSE guest (cancellation is pre-arrival only). Calls `checkOut`; the server
 * gates on a settled balance + no pending POS. When an unsettled balance blocks it
 * and the user holds `folio:defer`, a second "Check out & defer balance" action
 * completes the check-out and flags the balance as deferred (audited) — the
 * mechanism the error message points to. POS-pending is never deferrable.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkOut } from "../lifecycle-actions";

export function CheckOutButton({ reservationId, canDefer = false }: { reservationId: string; canDefer?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [balanceBlock, setBalanceBlock] = useState(false);
  const [pending, start] = useTransition();

  function submit(defer: boolean) {
    setError(null);
    start(async () => {
      const res = await checkOut({ reservationId, defer });
      if (!res.ok) {
        // Offer the defer path only for an unsettled balance (POS-pending must be resolved).
        setBalanceBlock(!defer && res.error.code === "BALANCE_UNSETTLED" && canDefer);
        setError(res.error.message || "Settle the balance on the folio before checking out.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" size="sm" disabled={pending} onClick={() => submit(false)} data-testid="check-out">
        <LogOut /> {pending ? "Checking out…" : "Check out"}
      </Button>
      {error && <span role="alert" className="max-w-xs text-right text-xs text-destructive">{error}</span>}
      {balanceBlock ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => submit(true)}
          data-testid="check-out-defer"
          className="border-amber-500/50 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
        >
          Check out &amp; defer balance
        </Button>
      ) : null}
    </div>
  );
}
