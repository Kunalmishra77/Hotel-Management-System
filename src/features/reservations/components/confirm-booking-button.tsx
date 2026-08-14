"use client";
/**
 * Confirm an ENQUIRY booking (a website/hold enquiry) → CONFIRMED, so reception
 * can proceed to check-in. Calls the ownership-checked `confirmReservation` action
 * and refreshes on success. Shown only for an ENQUIRY booking to a permitted user.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmReservation } from "../actions";

export function ConfirmBookingButton({ reservationId }: { reservationId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    setError(null);
    start(async () => {
      const res = await confirmReservation({ reservationId });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" onClick={confirm} disabled={pending} data-testid="confirm-booking">
        <CheckCircle2 /> {pending ? "Confirming…" : "Confirm booking"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </>
  );
}
