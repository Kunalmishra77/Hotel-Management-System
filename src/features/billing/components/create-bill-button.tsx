"use client";

/**
 * Create a bill (folio) for a reservation that doesn't have one — e.g. a stay saved
 * via Data Entry as "history only" (no rate) that now needs charges added (food the
 * guest already paid for). After it's created the page refreshes into the folio.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createReservationFolio } from "../folio-actions";

export function CreateBillButton({ reservationId }: { reservationId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Button
        size="lg"
        disabled={pending}
        data-testid="create-bill"
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await createReservationFolio({ reservationId });
            if (res.ok) router.refresh();
            else setError(res.error.message);
          })
        }
      >
        <ReceiptText /> {pending ? "Creating…" : "Create a bill for this stay"}
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
