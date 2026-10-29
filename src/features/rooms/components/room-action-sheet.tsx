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
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { QrCode, X, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { changeRoomStatus } from "../status-actions";
import { getRoomOrderQr } from "../order-qr-actions";
import type { BoardRoom } from "../queries";
import { STATUS_LABEL, shortDate } from "./room-chip";

export function RoomActionSheet({
  room,
  canBlock,
  canManage,
  onClose,
}: {
  room: BoardRoom | null;
  canBlock: boolean;
  canManage: boolean;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<{ url: string; qrDataUrl: string; number: string } | null>(null);

  // Reset the QR preview when another room is opened.
  const roomId = room?.id;
  useEffect(() => setQr(null), [roomId]);

  if (!room) return null;

  // The board status is DERIVED from bookings: an occupied / reserved room always
  // has its booking here. Such a room must NOT be flipped vacant/clean by hand —
  // check-in / check-out on the booking drives it.
  const isBooked = room.status === "OCCUPIED" || room.status === "RESERVED";
  const booking = room.booking;
  // Stored status still says booked although no booking holds the room today —
  // the old drift. Offer the manual reset (transitions start from the stored status).
  const stale = !isBooked && (room.storedStatus === "OCCUPIED" || room.storedStatus === "RESERVED");

  const showQr = () => {
    setError(null);
    startTransition(async () => {
      const res = await getRoomOrderQr({ roomId: room.id });
      if (res.ok) setQr(res.data);
      else setError(res.error.message);
    });
  };

  const printQr = () => {
    if (!qr) return;
    const w = window.open("", "_blank", "width=420,height=560");
    if (!w) return;
    w.document.write(
      `<title>Room ${qr.number} · Order QR</title><body style="font-family:system-ui;text-align:center;padding:24px">` +
        `<h2>Room ${qr.number}</h2><p>Scan to order to your room</p>` +
        `<img src="${qr.qrDataUrl}" width="240" height="240" alt="Room ${qr.number} ordering QR"/>` +
        `<p style="font-size:12px;color:#555;word-break:break-all">${qr.url}</p></body>`,
    );
    w.document.close();
    w.focus();
    w.print();
  };

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

        {booking && (
          <Link
            href={`/bookings/${booking.reservationId}`}
            className="mb-3 flex items-center justify-between gap-2 rounded-md border bg-muted/40 p-3 text-sm hover:bg-muted"
            data-testid="room-view-booking"
          >
            <span className="min-w-0">
              <span className="font-medium">{booking.guestName ?? "Booked"}</span>
              <span className="text-muted-foreground"> · {booking.code} · {room.departingToday ? "leaves today" : `free from ${shortDate(booking.until)}`}</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-primary">View booking <ArrowUpRight className="size-3.5" /></span>
          </Link>
        )}
        {room.next && (
          <Link
            href={`/bookings/${room.next.reservationId}`}
            className="mb-3 block rounded-md border p-3 text-sm hover:bg-muted"
            data-testid="room-next-booking"
          >
            <span className="text-muted-foreground">Next booking: </span>
            <span className="font-medium">{room.next.guestName ?? room.next.code}</span>
            <span className="text-muted-foreground"> · arrives {shortDate(room.next.from)}</span>
          </Link>
        )}

        {isBooked ? (
          // Booked room: no manual vacant/cleaning here — the booking's check-in /
          // check-out drives the status.
          <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground" data-testid="room-booked-note">
            This room is {room.status === "OCCUPIED" ? "occupied by" : "reserved for"} <span className="font-medium text-foreground">{booking?.guestName ?? "a guest"}</span>. To free it, {room.status === "OCCUPIED" ? "check out" : "cancel or check in"} from the booking above — it can&apos;t be marked vacant by hand.
          </p>
        ) : stale ? (
          <div className="space-y-2">
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              No booking holds this room today, but its saved status is still {STATUS_LABEL[room.storedStatus].toLowerCase()}. Reset it:
            </p>
            {room.allowedTransitions.map((to) => (
              <Button key={to} block variant="outline" size="lg" disabled={pending} onClick={() => apply(to)} data-testid={`room-action-${to}`}>
                Mark {STATUS_LABEL[to].toLowerCase()}
              </Button>
            ))}
          </div>
        ) : room.allowedTransitions.length === 0 ? (
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

        {canManage && (
          <div className="mt-4 border-t pt-3">
            {qr ? (
              <div className="flex flex-col items-center gap-2 text-center">
                {/* eslint-disable-next-line @next/next/no-img-element -- data-URI QR, not a remote asset */}
                <img src={qr.qrDataUrl} width={200} height={200} alt={`Room ${room.number} ordering QR`} data-testid="room-order-qr" />
                <p className="break-all text-xs text-muted-foreground">{qr.url}</p>
                <Button variant="outline" size="sm" onClick={printQr}>Print</Button>
              </div>
            ) : (
              <Button
                block
                variant="ghost"
                size="lg"
                disabled={pending}
                onClick={showQr}
                data-testid="room-show-qr"
              >
                <QrCode className="size-4" /> In-room ordering QR
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
