"use client";

/**
 * "Guest arrived — undo no-show": reactivates a NO_SHOW booking back to CONFIRMED
 * so reception can assign a room and check the guest in. For a guest who actually
 * arrived (late / after midnight) or whom a busy front desk hadn't checked in yet.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reactivateNoShow } from "../lifecycle-actions";

export function ReactivateNoShowButton({ reservationId }: { reservationId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function onClick() {
    if (!window.confirm("Undo no-show? The booking goes back to Confirmed so you can assign a room and check the guest in.")) return;
    setErr(null);
    start(async () => {
      const res = await reactivateNoShow({ reservationId });
      if (res.ok) router.refresh();
      else setErr(res.error?.message ?? "Could not undo the no-show.");
    });
  }

  return (
    <>
      <Button size="sm" onClick={onClick} disabled={pending} data-testid="reactivate-no-show">
        <UserCheck /> {pending ? "Undoing…" : "Guest arrived — undo no-show"}
      </Button>
      {err && <span className="text-xs text-destructive" role="alert">{err}</span>}
    </>
  );
}
