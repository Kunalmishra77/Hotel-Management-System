"use client";
/**
 * Super-Admin Bookings — per-property booking outcomes + a recent-bookings feed
 * across every property, on the shared DataTable (sortable/searchable, rows click
 * through). Counts come from the booking-count queries; no metric is recomputed.
 */
import { DataTable, type Column } from "@/components/ui/data-table";
import type { PropertyBookingStat, PortfolioBookingRow } from "@/features/command-center/queries";

const STATUS_TONE: Record<string, string> = {
  IN_HOUSE: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  CONFIRMED: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  CHECKED_OUT: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  ENQUIRY: "bg-muted text-muted-foreground",
  CANCELLED: "bg-destructive/12 text-destructive",
  NO_SHOW: "bg-destructive/12 text-destructive",
};
const fmtDate = (d: Date) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
const SOURCE_LABEL: Record<string, string> = {
  WALK_IN: "Walk-in", DIRECT: "Direct", WEBSITE: "Website", PHONE: "Phone", CORPORATE: "Corporate",
  TRAVEL_AGENT: "Travel agent", BOOKING_COM: "Booking.com", MAKEMYTRIP: "MakeMyTrip", GOIBIBO: "Goibibo",
  AGODA: "Agoda", AIRBNB: "Airbnb",
};

export function PerPropertyBookingsTable({ rows }: { rows: PropertyBookingStat[] }) {
  const columns: Column<PropertyBookingStat>[] = [
    { key: "name", header: "Property", cell: (r) => <span className="font-medium">{r.name}</span>, sortValue: (r) => r.name.toLowerCase() },
    { key: "bookings", header: "Bookings", align: "right", cell: (r) => <span className="tabular font-semibold">{r.bookings}</span>, sortValue: (r) => r.bookings },
    { key: "cancelled", header: "Cancelled", align: "right", cell: (r) => <span className="tabular text-muted-foreground">{r.cancelled}</span>, sortValue: (r) => r.cancelled, hideBelow: "sm" },
    { key: "noShow", header: "No-show", align: "right", cell: (r) => <span className="tabular text-muted-foreground">{r.noShow}</span>, sortValue: (r) => r.noShow, hideBelow: "sm" },
    {
      key: "rate", header: "Cancel rate", align: "right",
      cell: (r) => {
        const d = r.bookings + r.cancelled + r.noShow;
        const pct = d > 0 ? Math.round(((r.cancelled + r.noShow) / d) * 100) : 0;
        return <span className={`tabular ${pct > 20 ? "text-destructive" : "text-muted-foreground"}`}>{pct}%</span>;
      },
      sortValue: (r) => { const d = r.bookings + r.cancelled + r.noShow; return d > 0 ? (r.cancelled + r.noShow) / d : 0; },
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowKey={(r) => r.propertyId}
      getRowHref={(r) => `/overview/${r.propertyId}`}
      initialSort={{ key: "bookings", dir: "desc" }}
      pageSize={12}
      empty={<p className="text-sm text-muted-foreground">No bookings in this period.</p>}
    />
  );
}

export function RecentBookingsTable({ rows }: { rows: PortfolioBookingRow[] }) {
  const columns: Column<PortfolioBookingRow>[] = [
    { key: "code", header: "Booking", cell: (r) => <span className="font-mono text-sm font-medium">{r.code}</span>, sortValue: (r) => r.code },
    { key: "guest", header: "Guest", cell: (r) => <span className="truncate">{r.guestName}</span>, sortValue: (r) => r.guestName.toLowerCase() },
    { key: "property", header: "Property", cell: (r) => <span className="truncate text-muted-foreground">{r.propertyName}</span>, sortValue: (r) => r.propertyName.toLowerCase(), hideBelow: "md" },
    { key: "source", header: "Source", cell: (r) => <span className="text-muted-foreground">{SOURCE_LABEL[r.source] ?? r.source}</span>, sortValue: (r) => r.source, hideBelow: "lg" },
    {
      key: "dates", header: "Dates", cell: (r) => <span className="tabular text-muted-foreground">{fmtDate(r.checkInDate)} → {fmtDate(r.checkOutDate)}</span>,
      sortValue: (r) => new Date(r.checkInDate).getTime(), hideBelow: "sm",
    },
    {
      key: "status", header: "Status", align: "right",
      cell: (r) => <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[r.status] ?? "bg-muted text-muted-foreground"}`}>{r.status.replace(/_/g, " ")}</span>,
      sortValue: (r) => r.status,
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowKey={(r) => r.id}
      getRowHref={(r) => `/bookings/${r.id}`}
      searchable={{ placeholder: "Search booking, guest or property…", accessor: (r) => `${r.code} ${r.guestName} ${r.propertyName}` }}
      pageSize={12}
      empty={<p className="text-sm text-muted-foreground">No bookings yet.</p>}
    />
  );
}
