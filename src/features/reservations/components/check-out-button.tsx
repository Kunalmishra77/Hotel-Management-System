"use client";

/**
 * Check-out from the booking page (03 lifecycle) — the correct action for an
 * IN_HOUSE guest (cancellation is pre-arrival only). Calls `checkOut`; the server
 * gates on a settled balance + no pending POS. When an unsettled balance blocks it
 * and the user holds `folio:defer`, a second "Check out & defer balance" action
 * completes the check-out and flags the balance as deferred (audited) — the
 * mechanism the error message points to. POS-pending is never deferrable.
 *
 * Overdue check-out (booked date already passed — client rule, 15 Nov 2026):
 * the button first asks what happened. "Left on <booked date>" bills to the
 * booked date (the usual case: staff forgot to press it); "Stayed till today"
 * bills every night through today.
 *
 * Early departure (booked check-out still ahead — client, 16 Nov 2026): the
 * button asks what happens to the unused nights. "Keep the prepaid money"
 * (default for an OTA booking — prepaid, non-refundable) bills it as an
 * early-departure charge so the bill isn't left in minus; "Refund" takes the
 * nights off and leaves any prepaid excess as a refund due.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkOut } from "../lifecycle-actions";

export function CheckOutButton({
  reservationId,
  canDefer = false,
  overdueSince,
  leavingEarly,
}: {
  reservationId: string;
  canDefer?: boolean;
  /** Booked check-out (e.g. "31 Oct") when it has already passed; omit otherwise. */
  overdueSince?: string;
  /** Booked check-out still ahead (e.g. "28 Nov"); `ota` = sold on an OTA (prepaid). */
  leavingEarly?: { until: string; ota: boolean };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [balanceBlock, setBalanceBlock] = useState(false);
  const [asking, setAsking] = useState(false);
  const [stayedLate, setStayedLate] = useState(false);
  const [unused, setUnused] = useState<"refund" | "retain">(leavingEarly?.ota ? "retain" : "refund");
  const [pending, start] = useTransition();

  function submit(defer: boolean, late = stayedLate, unusedNights = unused) {
    setError(null);
    setAsking(false);
    setStayedLate(late);
    setUnused(unusedNights);
    start(async () => {
      const res = await checkOut({ reservationId, defer, stayedLate: late, unusedNights });
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
    <div className="flex flex-col items-end gap-1.5">
      {!balanceBlock && !asking ? (
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => (overdueSince || leavingEarly ? setAsking(true) : submit(false))}
          data-testid="check-out"
          className={overdueSince ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
        >
          <LogOut /> {pending ? "Checking out…" : overdueSince ? `Check out (was due ${overdueSince})` : "Check out"}
        </Button>
      ) : null}
      {asking && leavingEarly && !overdueSince ? (
        <div className="flex max-w-sm flex-col items-end gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-right" data-testid="check-out-early">
          <p className="text-xs text-foreground">
            The guest was booked until <strong>{leavingEarly.until}</strong>. What happens to the unused nights?
          </p>
          <Button type="button" size="sm" variant={leavingEarly.ota ? "default" : "outline"} disabled={pending} onClick={() => submit(false, false, "retain")} data-testid="check-out-retain">
            <LogOut /> Keep the prepaid money (non-refundable)
          </Button>
          <Button type="button" size="sm" variant={leavingEarly.ota ? "outline" : "default"} disabled={pending} onClick={() => submit(false, false, "refund")} data-testid="check-out-refund">
            <LogOut /> Bill only the nights stayed (refund the rest)
          </Button>
          <p className="text-[11px] text-muted-foreground">
            {leavingEarly.ota ? "OTA bookings are usually prepaid and non-refundable." : "Keep only applies to money already paid."}
          </p>
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setAsking(false)}>Cancel</button>
        </div>
      ) : null}
      {asking && overdueSince ? (
        <div className="flex max-w-sm flex-col items-end gap-1.5 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-right" data-testid="check-out-overdue">
          <p className="text-xs text-foreground">
            Check-out was due on <strong>{overdueSince}</strong>. When did the guest leave?
          </p>
          <Button type="button" size="sm" disabled={pending} onClick={() => submit(false, false)} data-testid="check-out-as-booked">
            <LogOut /> Left on {overdueSince} — bill till then
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => submit(false, true)} data-testid="check-out-stayed-late">
            Stayed till today — bill the extra nights
          </Button>
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setAsking(false)}>Cancel</button>
        </div>
      ) : null}
      {error && !balanceBlock ? <span role="alert" className="max-w-xs text-right text-xs text-destructive">{error}</span> : null}
      {balanceBlock ? (
        <div className="flex max-w-xs flex-col items-end gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-right">
          <p className="text-xs text-amber-800 dark:text-amber-300">
            Balance still pending on this folio. Settle it on the folio, or check out now and defer the balance (recorded &amp; audited).
          </p>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => submit(true)}
            data-testid="check-out-defer"
            className="bg-amber-600 text-white hover:bg-amber-700"
          >
            <LogOut /> {pending ? "Checking out…" : "Check out anyway (defer balance)"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
