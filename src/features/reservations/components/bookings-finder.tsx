"use client";

/**
 * Bookings finder — the filterable bookings list on both Bookings pages (front
 * desk and all-hotels). Every filter lives in the URL (see domain/finder.ts), so a
 * KPI card or status chip elsewhere on the page is just a link into a view here.
 * Filtering/sorting run on the server over ALL bookings; the table's own search
 * then narrows the returned rows instantly.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PropertyBadge } from "@/components/ui/property-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { propertyColor } from "@/lib/property-colors";
import { finderPresets, type FinderParams } from "../domain/finder";
import type { BookingFinderResult, BookingFinderRow } from "../finder-queries";

const STATUS_CHIPS: { key: FinderParams["status"]; label: string; tone: string }[] = [
  { key: null, label: "All", tone: "bg-foreground/5 text-foreground" },
  { key: "ENQUIRY", label: "Enquiry / hold", tone: "bg-muted text-muted-foreground" },
  { key: "CONFIRMED", label: "Confirmed", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  { key: "IN_HOUSE", label: "In-house", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  { key: "CHECKED_OUT", label: "Checked out", tone: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  { key: "CANCELLED", label: "Cancelled", tone: "bg-destructive/12 text-destructive" },
  { key: "NO_SHOW", label: "No-show", tone: "bg-destructive/12 text-destructive" },
  { key: "ATTENTION", label: "Needs attention", tone: "bg-orange-500/15 text-orange-700 dark:text-orange-400" },
];
const STATUS_TONE = Object.fromEntries(STATUS_CHIPS.filter((s) => s.key).map((s) => [s.key, s.tone])) as Record<string, string>;
const SOURCE_LABEL: Record<string, string> = {
  WALK_IN: "Walk-in", DIRECT: "Direct", WEBSITE: "Website", PHONE: "Phone", CORPORATE: "Corporate",
  TRAVEL_AGENT: "Travel agent", BOOKING_COM: "Booking.com", MAKEMYTRIP: "MakeMyTrip", EXPEDIA: "Expedia", GOIBIBO: "Goibibo",
  AGODA: "Agoda", AIRBNB: "Airbnb",
};
const DATE_FIELD_LABEL: Record<FinderParams["dateField"], string> = {
  arrival: "Arrival", departure: "Departure", stay: "Staying", booked: "Booked on",
};
const SORT_LABEL: Record<FinderParams["sort"], string> = {
  arrival: "Arrival (earliest first)", departure: "Departure (earliest first)", guest: "Guest name A–Z", newest: "Newest booking first",
};
const fmt = (d: Date) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
const selectCls = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

export function BookingsFinder({
  result,
  params,
  properties,
  today,
  keep = {},
  title = "Bookings",
}: {
  result: BookingFinderResult;
  params: FinderParams;
  /** Properties the user can pick from; the property filter shows when there's more than one. */
  properties: { id: string; name: string }[];
  /** Property-local today (yyyy-mm-dd) for the date presets. */
  today: string;
  /** Other page params to carry along (period window, desk mode…). */
  keep?: Record<string, string | undefined>;
  title?: string;
}) {
  const router = useRouter();

  /** URL for this page with the finder params patched; lands on the list. */
  const href = (patch: Partial<Record<"prop" | "status" | "bdate" | "bfrom" | "bto" | "sort", string | null>>) => {
    const cur: Record<string, string | null> = {
      prop: params.prop, status: params.status, bdate: params.from || params.to ? params.dateField : null,
      bfrom: params.from, bto: params.to, sort: params.sort,
      ...patch,
    };
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) qs.set(k, v);
    for (const [k, v] of Object.entries(cur)) if (v) qs.set(k, v);
    return `/bookings?${qs.toString()}#bookings-list`;
  };
  const go = (patch: Parameters<typeof href>[0]) => router.push(href(patch), { scroll: false });

  const total = Object.entries(result.statusCounts).filter(([k]) => k !== "ATTENTION").reduce((s, [, n]) => s + n, 0);
  const hasDate = Boolean(params.from || params.to);
  const presets = finderPresets(today);

  const columns: Column<BookingFinderRow>[] = [
    { key: "code", header: "Booking", cell: (r) => <span className="font-mono text-sm font-medium">{r.code}</span>, sortValue: (r) => r.code },
    { key: "guest", header: "Guest", cell: (r) => <span className="truncate">{r.guestName}</span>, sortValue: (r) => r.guestName.toLowerCase() },
    ...(properties.length > 1
      ? [{ key: "property", header: "Property", cell: (r: BookingFinderRow) => <PropertyBadge name={r.propertyName} />, sortValue: (r: BookingFinderRow) => r.propertyName.toLowerCase(), hideBelow: "md" as const }]
      : []),
    { key: "rooms", header: "Room", cell: (r) => <span className="text-muted-foreground">{r.roomNumbers.join(", ") || "—"}</span>, sortValue: (r) => r.roomNumbers.join(","), hideBelow: "lg" },
    { key: "arrival", header: "Arrival", cell: (r) => <span className="tabular">{fmt(r.checkInDate)}</span>, sortValue: (r) => new Date(r.checkInDate).getTime() },
    { key: "departure", header: "Departure", cell: (r) => <span className="tabular">{fmt(r.checkOutDate)}</span>, sortValue: (r) => new Date(r.checkOutDate).getTime(), hideBelow: "sm" },
    { key: "nights", header: "Nights", align: "right", cell: (r) => <span className="tabular">{r.nights}</span>, sortValue: (r) => r.nights, hideBelow: "lg" },
    { key: "source", header: "Source", cell: (r) => <span className="text-muted-foreground">{SOURCE_LABEL[r.source] ?? r.source}</span>, sortValue: (r) => r.source, hideBelow: "xl" },
    {
      key: "status", header: "Status", align: "right",
      cell: (r) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[r.status] ?? "bg-muted text-muted-foreground"}`}>
          {r.status.replace(/_/g, " ")}{r.needsAttention ? " ⚠" : ""}
        </span>
      ),
      sortValue: (r) => r.status,
    },
  ];

  return (
    <Card id="bookings-list" className="scroll-mt-4" data-testid="bookings-finder">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {title}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            ({result.rows.length}{result.truncated ? "+" : ""})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status chips — counts follow the current property + date filter. */}
        <div className="flex flex-wrap gap-2" data-testid="finder-status-chips">
          {STATUS_CHIPS.map((s) => {
            const n = s.key ? (result.statusCounts[s.key] ?? 0) : total;
            const active = params.status === s.key;
            return (
              <Link
                key={s.label}
                href={href({ status: s.key })}
                scroll={false}
                className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-offset-background transition hover:opacity-80", s.tone, active && "ring-2 ring-primary ring-offset-2")}
                aria-current={active ? "true" : undefined}
                data-testid={`finder-status-${s.key ?? "ALL"}`}
              >
                {s.label} <span className="tabular font-semibold">{n}</span>
              </Link>
            );
          })}
        </div>

        {/* Filters */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {properties.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor="f-prop">Property</Label>
              <select id="f-prop" className={selectCls} value={params.prop} onChange={(e) => go({ prop: e.target.value })} data-testid="finder-property">
                <option value="all">All properties</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="f-date">Date</Label>
            <select id="f-date" className={selectCls} value={params.dateField} onChange={(e) => go({ bdate: e.target.value, bfrom: params.from ?? today, bto: params.to ?? today })} data-testid="finder-date-field">
              {(Object.keys(DATE_FIELD_LABEL) as FinderParams["dateField"][]).map((k) => <option key={k} value={k}>{DATE_FIELD_LABEL[k]}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-from">From</Label>
            <Input id="f-from" type="date" value={params.from ?? ""} onChange={(e) => go({ bdate: params.dateField, bfrom: e.target.value || null })} data-testid="finder-from" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-to">To</Label>
            <Input id="f-to" type="date" value={params.to ?? ""} onChange={(e) => go({ bdate: params.dateField, bto: e.target.value || null })} data-testid="finder-to" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-sort">Sort</Label>
            <select id="f-sort" className={selectCls} value={params.sort} onChange={(e) => go({ sort: e.target.value })} data-testid="finder-sort">
              {(Object.keys(SORT_LABEL) as FinderParams["sort"][]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
            </select>
          </div>
        </div>

        {/* One-tap date presets for the chosen date (Arrival / Departure / …). */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{DATE_FIELD_LABEL[params.dateField]}:</span>
          {presets.map((p) => {
            const active = params.from === p.from && params.to === p.to;
            return (
              <Link key={p.key} href={href({ bdate: params.dateField, bfrom: p.from, bto: p.to })} scroll={false}
                className={cn("rounded-md border px-2.5 py-1 hover:bg-muted", active && "border-primary bg-primary/10 font-medium text-primary")}
                data-testid={`finder-preset-${p.key}`}>
                {p.label}
              </Link>
            );
          })}
          {hasDate && (
            <Link href={href({ bdate: null, bfrom: null, bto: null })} scroll={false} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" data-testid="finder-clear-dates">
              Any date ✕
            </Link>
          )}
        </div>

        {result.truncated && (
          <p className="text-xs text-amber-700 dark:text-amber-400">Showing the first {result.rows.length} matches — narrow the dates or status to see the rest.</p>
        )}

        <DataTable
          columns={columns}
          rows={result.rows}
          getRowKey={(r) => r.id}
          getRowHref={(r) => `/bookings/${r.id}`}
          // Each property's colour on its rows (client req #11) — tells hotels apart at a glance.
          getRowClassName={(r) => propertyColor(r.propertyName).row}
          searchable={{ placeholder: "Search booking, guest, room or property…", accessor: (r) => `${r.code} ${r.guestName} ${r.propertyName} ${r.roomNumbers.join(" ")}` }}
          pageSize={20}
          empty={<p className="text-sm text-muted-foreground">No bookings match these filters.</p>}
        />
      </CardContent>
    </Card>
  );
}
