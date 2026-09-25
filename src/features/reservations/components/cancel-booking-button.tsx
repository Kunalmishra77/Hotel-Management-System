"use client";

/**
 * Manual cancellation (03 FR-20) — phone/walk-in cancellations by staff. Asks for
 * a reason, calls `cancelReservation`, then refreshes so the booking shows
 * CANCELLED. Frees the room (handled server-side).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cancelReservation } from "../lifecycle-actions";

export function CancelBookingButton({ reservationId }: { reservationId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const res = await cancelReservation({ reservationId, reason: reason.trim() || "Cancelled by reception" });
      if (!res.ok) { setError(res.error.message); return; }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" className="text-destructive" onClick={() => setOpen(true)} data-testid="cancel-booking">
        <XCircle /> Cancel booking
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (e.g. guest cancelled by phone)" className="h-9 w-64" data-testid="cancel-reason" />
      <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={submit} data-testid="cancel-confirm">
        {pending ? "Cancelling…" : "Confirm cancel"}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Keep</Button>
      {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
    </div>
  );
}
