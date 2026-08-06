import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Room / booking status pill — the ONE place a status colour is rendered.
 * Colours come from the status token map (globals.css); features never invent
 * their own. A leading dot carries the colour so the label stays readable.
 */
export type RoomStatus = "vacant" | "occupied" | "reserved" | "housekeeping" | "maintenance";

const LABELS: Record<RoomStatus, string> = {
  vacant: "Vacant",
  occupied: "Occupied",
  reserved: "Reserved",
  housekeeping: "Housekeeping",
  maintenance: "Maintenance",
};

const DOT: Record<RoomStatus, string> = {
  vacant: "bg-status-vacant",
  occupied: "bg-status-occupied",
  reserved: "bg-status-reserved",
  housekeeping: "bg-status-housekeeping",
  maintenance: "bg-status-maintenance",
};

const TINT: Record<RoomStatus, string> = {
  vacant: "bg-status-vacant/10 text-status-vacant",
  occupied: "bg-status-occupied/10 text-status-occupied",
  reserved: "bg-status-reserved/12 text-status-reserved",
  housekeeping: "bg-status-housekeeping/12 text-status-housekeeping",
  maintenance: "bg-status-maintenance/12 text-status-maintenance",
};

export function StatusPill({
  status,
  label,
  className,
}: {
  status: RoomStatus;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TINT[status],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOT[status])} aria-hidden />
      {label ?? LABELS[status]}
    </span>
  );
}
