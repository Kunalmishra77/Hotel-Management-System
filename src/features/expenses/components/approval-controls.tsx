"use client";
/**
 * Approve / reject controls for a pending (DRAFT) expense (architecture v2 ·
 * Approvals). Reuses the existing approveExpense / rejectExpense actions — the
 * server re-checks expense:approve (or expense:approve-large for big amounts).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { approveExpense, rejectExpense } from "../actions";

export function ApprovalControls({ expenseId }: { expenseId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  function approve() {
    setError(null);
    start(async () => {
      const res = await approveExpense({ expenseId });
      if (!res.ok) return setError(res.error.message);
      router.refresh();
    });
  }

  function reject() {
    setError(null);
    if (reason.trim().length < 1) return setError("Add a reason to reject.");
    start(async () => {
      const res = await rejectExpense({ expenseId, reason: reason.trim() });
      if (!res.ok) return setError(res.error.message);
      router.refresh();
    });
  }

  if (rejecting) {
    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for rejection"
          maxLength={300}
          className="min-h-touch flex-1 rounded-md border bg-background px-3 text-sm"
        />
        <div className="flex gap-2">
          <Button size="sm" variant="destructive" onClick={reject} disabled={pending}>{pending ? "…" : "Confirm reject"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setRejecting(false)} disabled={pending}>Cancel</Button>
        </div>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={approve} disabled={pending}>{pending ? "Approving…" : "Approve"}</Button>
      <Button size="sm" variant="outline" onClick={() => setRejecting(true)} disabled={pending}>Reject</Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
