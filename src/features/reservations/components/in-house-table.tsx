"use client";
/**
 * In-house guest table (Reception) — the front desk's live working list of who is
 * staying right now. Ordered by actual check-in time (newest first) so the guest
 * you just checked in is on top; searchable, sortable, paginated. Each row opens
 * the booking (folio · charges · check-out).
 */
import { BedDouble, CircleDot, LogOut, AlertTriangle } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { formatDayMonth } from "@/lib/utils";
import type { ReservationListItem } from "../queries";

function ago(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
const isToday = (d: Date): boolean => new Date(d).toDateString() === new Date().toDateString();

export function InHouseTable({ rows }: { rows: ReservationListItem[] }) {
  const columns: Column<ReservationListItem>[] = [
    {
      key: "guest",
      header: "Guest",
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-semibold text-foreground">{r.guestName}</div>
          <div className="text-xs text-muted-foreground">{r.code}</div>
        </div>
      ),
      sortValue: (r) => r.guestName.toLowerCase(),
    },
    {
      key: "room",
      header: "Room",
      cell: (r) =>
        r.roomNumbers.length ? (
          <span className="inline-flex items-center gap-1.5 font-medium">
            <BedDouble className="size-3.5 text-muted-foreground" aria-hidden="true" />
            {r.roomNumbers.join(", ")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            Unallocated
          </span>
        ),
      sortValue: (r) => r.roomNumbers[0] ?? "~",
    },
    {
      key: "checkedIn",
      header: "Checked in",
      cell: (r) => (
        <span className="text-muted-foreground">{r.checkInAt ? ago(new Date(r.checkInAt)) : "—"}</span>
      ),
      sortValue: (r) => (r.checkInAt ? new Date(r.checkInAt).getTime() : 0),
      hideBelow: "sm",
    },
    {
      key: "nights",
      header: "Nights",
      align: "center",
      cell: (r) => <span className="tabular">{r.nights}</span>,
      sortValue: (r) => r.nights,
      hideBelow: "md",
    },
    {
      key: "checkout",
      header: "Check-out",
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          <span className="tabular text-muted-foreground">{formatDayMonth(new Date(r.checkOutDate))}</span>
          {isToday(new Date(r.checkOutDate)) && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
              <LogOut className="size-3" aria-hidden="true" /> Today
            </span>
          )}
        </span>
      ),
      sortValue: (r) => new Date(r.checkOutDate).getTime(),
    },
    {
      key: "status",
      header: "Status",
      align: "right",
      cell: (r) =>
        r.needsAttention ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
            <AlertTriangle className="size-3" aria-hidden="true" /> {r.needsAttention}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
            <CircleDot className="size-3" aria-hidden="true" /> In-house
          </span>
        ),
      hideBelow: "lg",
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowKey={(r) => r.id}
      getRowHref={(r) => `/bookings/${r.id}`}
      searchable={{ placeholder: "Search guest, room or code…", accessor: (r) => `${r.guestName} ${r.code} ${r.roomNumbers.join(" ")}` }}
      initialSort={{ key: "checkedIn", dir: "desc" }}
      pageSize={12}
    />
  );
}
