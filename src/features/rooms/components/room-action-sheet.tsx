"use client";

/**
 * Room action sheet — 02 T-15 (AC-5/AC-7).
 *
 * design.md: "Tap R-101 → bottom sheet with allowed status actions for the
 * user's role + 'block for maintenance'."
 *
 * The options come from `room.allowedTransitions`, which the SERVER computed
 * with `allowedTransitionsForRole`. The sheet therefore cannot offer an action
 * the caller may not perform — and `changeRoomStatus` re-checks anyway, because
 * hiding a button is not authorization.
 *
 * A bottom sheet rather than a dialog: mobile-first.md puts primary actions in
 * thumb reach, and this is used one-handed while walking a corridor.
 */
import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { changeRoomStatus } from "../status-actions";
import type { BoardRoom } from "../queries";
import { STATUS_LABEL } from "./room-chip";

export function RoomActionSheet({
  room,
  canBlock,
  onClose,
}: {
  room: BoardRoom | null;
  canBlock: boolean;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!room) return null;

  const apply = (to: string) => {
    setError(null);
    startTransition(async () => {
      const result = await changeRoomStatus({ roomId: room.id, to });
      if (result.ok) onClose();
      else setError(result.error.message);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />

      <div
        role="dialog"
        aria-modal="true"
        // Leads with the room so a screen reader announces the subject
        // first — "Room 101 actions", not "Actions for room 101" — and it
        // matches the visible heading.
        aria-label={`Room ${room.number} actions`}
        className={cn(
          "relative w-full rounded-t-xl border bg-background p-4 shadow-lg",
          "pb-[calc(env(safe-area-inset-bottom)+1rem)]",
          "sm:max-w-sm sm:rounded-xl sm:pb-4",
        )}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Room {room.number}</h2>
            <p className="text-sm text-muted-foreground">
              {room.categoryName}
              {room.floorName ? ` · Floor ${room.floorName}` : ""} ·{" "}
              {STATUS_LABEL[room.status]}
              {room.blockedToday && " · blocked"}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>

        {room.allowedTransitions.length === 0 ? (
          <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            Your role can&apos;t change this room&apos;s status right now.
          </p>
        ) : (
          <ul className="space-y-2">
            {room.allowedTransitions.map((to) => (
              <li key={to}>
                <Button
                  block
                  variant="outline"
                  size="lg"
                  disabled={pending}
                  onClick={() => apply(to)}
                  data-testid={`room-action-${to}`}
                >
                  Mark {STATUS_LABEL[to].toLowerCase()}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p id="room-action-error" role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {canBlock && (
          <p className="mt-3 text-xs text-muted-foreground">
            Date-ranged maintenance blocks are raised from the maintenance job (module 11); a
            block removes the room from availability without changing its status.
          </p>
        )}
      </div>
    </div>
  );
}
