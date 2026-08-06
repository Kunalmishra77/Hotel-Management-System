"use client";

import { useTransition } from "react";
import { Loader2, LogOut, Monitor } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatIstDateTime } from "@/lib/utils";
import { revokeOtherSessionsAction, revokeSessionAction } from "../session-actions";
import type { ActiveSessionView } from "../session-queries";

export function SessionsList({
  sessions,
  currentId,
}: {
  sessions: ActiveSessionView[];
  currentId: string;
}) {
  const [pending, start] = useTransition();
  const otherCount = sessions.filter((s) => s.id !== currentId).length;

  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-lg border">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 p-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                <Monitor className="size-4" />
              </span>
              <div className="min-w-0 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  {s.device || "Unknown device"}
                  {s.current ? <Badge variant="success">This device</Badge> : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  Signed in {formatIstDateTime(s.createdAt)}
                  {s.ip ? ` · ${s.ip}` : ""}
                </p>
              </div>
            </div>
            {!s.current ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await revokeSessionAction(s.id);
                    if (r.ok) toast.success("Device signed out");
                  })
                }
              >
                <LogOut className="size-4" /> Sign out
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {otherCount > 0 ? (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await revokeOtherSessionsAction();
              if (r.ok) toast.success(`Signed out ${r.count} other device${r.count === 1 ? "" : "s"}`);
            })
          }
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
          Sign out all other devices
        </Button>
      ) : null}
    </div>
  );
}
