"use client";

/**
 * Pending-sync indicator (17 T-8, FR-6). Presentational — the owning board holds
 * the queue count (its single source of truth) and passes it in. Shows nothing
 * at zero so it stays quiet until there is genuinely something waiting.
 */
import { Loader2 } from "lucide-react";

export function SyncStatus({ pending }: { pending: number }) {
  if (pending <= 0) return null;
  return (
    <span
      role="status"
      data-testid="sync-status"
      className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground"
    >
      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      {pending} pending sync
    </span>
  );
}
