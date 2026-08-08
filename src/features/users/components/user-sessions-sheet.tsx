"use client";

/**
 * Admin session-oversight sheet (16 FR-13). Lists a target user's live sessions
 * and lets an Administrator force sign-out of one device or all. Mirrors the
 * self-service SessionsList, but scoped to another user via `user:manage`.
 */
import { useCallback, useEffect, useState, useTransition } from "react";
import { Loader2, LogOut, Monitor } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatIstDateTime } from "@/lib/utils";
import { getUserSessions, revokeUserSessions } from "../actions";
import type { AdminSessionView } from "../queries";

export function UserSessionsSheet({
  user,
  onClose,
  onChanged,
}: {
  user: { id: string; name: string };
  onClose: () => void;
  onChanged: () => void;
}) {
  const [sessions, setSessions] = useState<AdminSessionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = useCallback(() => {
    start(async () => {
      const r = await getUserSessions(user.id);
      if (r.ok) setSessions(r.data);
      else setError(r.error.message);
    });
  }, [user.id]);

  useEffect(() => load(), [load]);

  const revoke = (sessionId?: string) =>
    start(async () => {
      const r = await revokeUserSessions({ userId: user.id, ...(sessionId ? { sessionId } : {}) });
      if (r.ok) {
        toast.success(
          sessionId
            ? "Device signed out"
            : `Signed out ${r.data.count} device${r.data.count === 1 ? "" : "s"}`,
        );
        onChanged();
        load();
      } else {
        toast.error(r.error.message);
      }
    });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Active sessions — {user.name}</SheetTitle>
          <SheetDescription>Signing out takes effect on the user&apos;s next request.</SheetDescription>
        </SheetHeader>
        <div className="mt-5 space-y-3">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {sessions === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active sessions.</p>
          ) : (
            <>
              <ul className="divide-y rounded-lg border">
                {sessions.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                        <Monitor className="size-4" />
                      </span>
                      <div className="min-w-0 text-sm">
                        <p className="font-medium">{s.device || "Unknown device"}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          Signed in {formatIstDateTime(s.createdAt)}
                          {s.ip ? ` · ${s.ip}` : ""}
                        </p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => revoke(s.id)}>
                      <LogOut className="size-4" /> Sign out
                    </Button>
                  </li>
                ))}
              </ul>
              <Button variant="outline" size="sm" disabled={pending} onClick={() => revoke()}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
                Sign out all sessions
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
