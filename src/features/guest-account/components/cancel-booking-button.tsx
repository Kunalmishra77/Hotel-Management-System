"use client";
/**
 * Cancel a booking from the guest detail view (Phase 2 T-6). Confirms, calls the
 * ownership-checked server action, and refreshes on success.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cancelMyBooking } from "../booking-actions";

export function CancelBookingButton({ reservationId }: { reservationId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function cancel() {
    setError(null);
    startTransition(async () => {
      const res = await cancelMyBooking(reservationId);
      if (!res.ok) {
        setError(res.error.message);
        setConfirming(false);
        return;
      }
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <Button variant="outline" onClick={() => setConfirming(true)}>
        Cancel booking
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Cancel this booking? This can&apos;t be undone.</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button variant="destructive" onClick={cancel} disabled={pending}>
          {pending ? "Cancelling…" : "Yes, cancel"}
        </Button>
        <Button variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
          Keep booking
        </Button>
      </div>
    </div>
  );
}
