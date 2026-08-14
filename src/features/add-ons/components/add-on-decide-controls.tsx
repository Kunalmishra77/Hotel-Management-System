"use client";
/**
 * Accept / decline controls for a pending guest add-on request (Wave 3). Accepting
 * posts the priced charge to the folio; it's disabled until the guest is checked
 * in (a folio exists only for an active stay). Declining posts nothing.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { decideAddOnRequest } from "../actions";

export function AddOnDecideControls({ id, chargeable }: { id: string; chargeable: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function decide(decision: "ACCEPT" | "DECLINE") {
    setError(null);
    start(async () => {
      const res = await decideAddOnRequest(id, decision);
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={pending || !chargeable} onClick={() => decide("ACCEPT")}>
        {pending ? "Working…" : chargeable ? "Accept & add to folio" : "Awaiting check-in"}
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => decide("DECLINE")}>
        Decline
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
