"use client";

/**
 * Check-out from the booking page (03 lifecycle) — the correct action for an
 * IN_HOUSE guest (cancellation is pre-arrival only). Calls `checkOut`; the server
 * gates on a settled balance + no pending POS, so if money is still due the error
 * is surfaced and the user is pointed to the folio to settle first.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkOut } from "../lifecycle-actions";

export function CheckOutButton({ reservationId }: { reservationId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const res = await checkOut({ reservationId });
      if (!res.ok) {
        setError(res.error.message || "Settle the balance on the folio before checking out.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" size="sm" disabled={pending} onClick={submit} data-testid="check-out">
        <LogOut /> {pending ? "Checking out…" : "Check out"}
      </Button>
      {error && <span role="alert" className="max-w-xs text-right text-xs text-destructive">{error}</span>}
    </div>
  );
}
