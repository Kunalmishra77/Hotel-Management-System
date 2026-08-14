"use client";
/**
 * Forward-only status controls for a guest request (Phase 4). Reception advances
 * a request (Acknowledge → In progress → Complete / Decline); the guest sees it.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NEXT_STATUSES, REQUEST_STATUS_LABEL } from "@/features/guest-account/domain/request-kind";
import { updateGuestRequestStatus } from "../actions";

export function RequestStatusControls({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const next = NEXT_STATUSES[status] ?? [];

  function set(to: string) {
    setError(null);
    startTransition(async () => {
      const res = await updateGuestRequestStatus(id, to);
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      router.refresh();
    });
  }

  if (next.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {next.map((to) => (
        <Button
          key={to}
          size="sm"
          variant={to === "DECLINED" ? "outline" : "default"}
          disabled={pending}
          onClick={() => set(to)}
        >
          {REQUEST_STATUS_LABEL[to] ?? to}
        </Button>
      ))}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
