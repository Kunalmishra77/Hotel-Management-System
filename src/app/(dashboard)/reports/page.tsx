import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/permissions";
import { NoProperty } from "@/features/platform/components/no-property";
import { profitReport, revenueSegments, bookingsReport, roomsReport, gstReport, gstInvoiceRegister, bookingsRegister } from "@/features/reports/queries";
import { perPropertyStats } from "@/features/analytics/queries";
import { perPropertyBillingRollup } from "@/features/command-center/queries";
import { listAccessibleProperties } from "@/features/platform/actions";
import { listCostCenters } from "@/features/properties/queries";
import { ProfitReportView } from "@/features/reports/components/profit-report-view";
import { ReportsFilterBar } from "@/features/reports/components/reports-filter-bar";
import { ExportReportButton } from "@/features/reports/components/export-report-button";
import { ReportTabs, REPORT_TYPES, type ReportType } from "@/features/reports/components/report-tabs";
import { ReportTable, type ReportColumn, type ReportRow } from "@/features/reports/components/report-table";
import { ExportTableButton } from "@/features/reports/components/export-table-button";

export const metadata: Metadata = { title: "Reports" };

const MONTH_RE = /^\d{4}-\d{2}$/;
const monthEnd = (month: string): Date => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0));
};
const isReport = (v: string | undefined): v is ReportType => REPORT_TYPES.some((t) => t.key === v);

const SOURCE_LABEL: Record<string, string> = {
  WALK_IN: "Walk-in", DIRECT: "Direct", WEBSITE: "Website", PHONE: "Phone", CORPORATE: "Corporate",
  TRAVEL_AGENT: "Travel agent", BOOKING_COM: "Booking.com", MAKEMYTRIP: "MakeMyTrip", GOIBIBO: "Goibibo",
  AGODA: "Agoda", AIRBNB: "Airbnb",
};
const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s.replace(/_/g, " ").toLowerCase();
const bpsToPct = (bps: number) => Math.round(bps / 100);

/**
 * 08 / 14 — management reports. A report-type selector (Profit / Occupancy /
 * Revenue-by-source / Outstanding dues), each for a chosen month + property set
 * (defaults to the current month; scope follows the top-bar property selector).
 * Every report exports to CSV. `report:view-financial`.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; month?: string; properties?: string }>;
}) {
  const user = await requirePermission("report:view-financial");
  const properties = await listAccessibleProperties();
  if (properties.length === 0) {
    return <NoProperty what="This page" canCreate={hasPermission(user, "property:manage")} />;
  }
  const accessibleIds = properties.map((p) => p.id);
  const nameOf = (id: string): string => properties.find((p) => p.id === id)?.name ?? id;

  const sp = await searchParams;
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const month = sp.month && MONTH_RE.test(sp.month) ? sp.month : currentMonth;
  const reportType: ReportType = isReport(sp.report) ? sp.report : "profit";

  const requested = (sp.properties?.split(",").filter(Boolean) ?? []).filter((id) => accessibleIds.includes(id));
  const defaultIds = user.activePropertyId && accessibleIds.includes(user.activePropertyId) ? [user.activePropertyId] : accessibleIds;
  const propertyIds = requested.length > 0 ? requested : defaultIds;
  const propsParam = requested.length > 0 ? requested.join(",") : "";

  // Overheads (office/HO/Other) are company-wide — included only in the all-hotels
  // view, never attributed to a specific hotel's P&L when one is selected.
  const costCenterIds = (await listCostCenters(user)).map((p) => p.id);
  const overheadPropertyIds = requested.length === 0 ? costCenterIds : [];

  const from = new Date(`${month}-01T00:00:00.000Z`);
  const to = month === currentMonth ? new Date(now.toISOString().slice(0, 10) + "T00:00:00.000Z") : monthEnd(month);

  const scopeLabel = propertyIds.length === 1
    ? (properties.find((p) => p.id === propertyIds[0])?.name ?? "1 property")
    : `All properties (${propertyIds.length})`;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
      <ReportsFilterBar properties={properties} selected={propertyIds} month={month} />
      <ReportTabs active={reportType} month={month} properties={propsParam} />

      {reportType === "profit" ? (
        await ProfitSection({ user, month, propertyIds, from, to, scopeLabel, propertyCount: propertyIds.length, overheadPropertyIds })
      ) : reportType === "occupancy" ? (
        await OccupancySection({ user, month, propertyIds, from, to })
      ) : reportType === "bookings" ? (
        await BookingsSection({ user, month, propertyIds, from, to, nameOf })
      ) : reportType === "rooms" ? (
        await RoomsSection({ user, month, propertyIds, from, to, nameOf })
      ) : reportType === "source" ? (
        await SourceSection({ user, month, propertyIds, from, to })
      ) : reportType === "gst" ? (
        await GstSection({ user, month, propertyIds, from, to, nameOf })
      ) : (
        await DuesSection({ user, propertyIds })
      )}
    </div>
  );
}

type SectionInput = { user: Awaited<ReturnType<typeof requirePermission>>; month: string; propertyIds: string[]; from: Date; to: Date };

async function ProfitSection({ user, month, propertyIds, from, to, scopeLabel, propertyCount, overheadPropertyIds }: SectionInput & { scopeLabel: string; propertyCount: number; overheadPropertyIds: string[] }) {
  const [report, segments] = await Promise.all([
    profitReport(user, { propertyIds, from, to, overheadPropertyIds }),
    revenueSegments(user, { propertyIds, from, to }),
  ]);
  return (
    <>
      <div className="flex justify-end"><ExportReportButton month={month} scopeLabel={scopeLabel} report={report} segments={segments} /></div>
      <ProfitReportView month={month} report={report} segments={segments} propertyCount={propertyCount} />
    </>
  );
}

async function OccupancySection({ user, month, propertyIds, from, to }: SectionInput) {
  const [stats, report] = await Promise.all([
    perPropertyStats(user, { propertyIds, from, to }),
    profitReport(user, { propertyIds, from, to }),
  ]);
  const columns: ReportColumn[] = [
    { key: "property", label: "Property", format: "property" },
    { key: "occupancy", label: "Occupancy", format: "percent" },
    { key: "adr", label: "ADR", format: "money" },
    { key: "revpar", label: "RevPAR", format: "money" },
    { key: "revenue", label: "Revenue", format: "money" },
  ];
  const rows: ReportRow[] = stats.map((s) => ({ property: s.name, occupancy: bpsToPct(s.occupancyBps), adr: s.adrPaise, revpar: s.revparPaise, revenue: s.revenuePaise }));
  const t = report.metrics;
  const totalsRow: ReportRow = { property: "All properties", occupancy: bpsToPct(t.occupancyBps), adr: t.adrPaise, revpar: t.revparPaise, revenue: report.breakdown.revenuePaise };
  return (
    <ReportSection title={`Occupancy & rate · ${month}`} subtitle="Occupancy %, ADR and RevPAR per property, from night-audit snapshots." filename={`occupancy-${month}.csv`} columns={columns} rows={rows} totalsRow={totalsRow} />
  );
}

async function SourceSection({ user, month, propertyIds, from, to }: SectionInput) {
  const segments = await revenueSegments(user, { propertyIds, from, to });
  const columns: ReportColumn[] = [
    { key: "source", label: "Booking source" },
    { key: "revenue", label: "Revenue", format: "money" },
  ];
  const rows: ReportRow[] = segments.bySource.map((s) => ({ source: sourceLabel(s.source), revenue: s.revenuePaise }));
  const total = segments.bySource.reduce((n, s) => n + s.revenuePaise, 0);
  const totalsRow: ReportRow = { source: "Total", revenue: total };
  const corpColumns: ReportColumn[] = [
    { key: "name", label: "Corporate / travel agent" },
    { key: "roomNights", label: "Room-nights", format: "text", align: "right" },
    { key: "revenue", label: "Revenue", format: "money" },
  ];
  const corpRows: ReportRow[] = segments.corporates.map((c) => ({ name: c.name, roomNights: c.roomNights, revenue: c.revenuePaise }));
  return (
    <>
      <ReportSection title={`Revenue by source · ${month}`} subtitle="Where the period's revenue came from (net of discounts, ex-tax)." filename={`revenue-by-source-${month}.csv`} columns={columns} rows={rows} totalsRow={totalsRow} />
      {corpRows.length > 0 ? (
        <ReportSection title="Top corporate clients & travel agents" subtitle="By revenue over the period." filename={`corporate-revenue-${month}.csv`} columns={corpColumns} rows={corpRows} />
      ) : null}
    </>
  );
}

async function BookingsSection({ user, month, propertyIds, from, to, nameOf }: SectionInput & { nameOf: (id: string) => string }) {
  const rows = await bookingsReport(user, { propertyIds, from, to });
  const columns: ReportColumn[] = [
    { key: "property", label: "Property", format: "property" },
    { key: "total", label: "Total", format: "text", align: "right" },
    { key: "confirmed", label: "Confirmed", format: "text", align: "right" },
    { key: "inHouse", label: "In-house", format: "text", align: "right" },
    { key: "checkedOut", label: "Checked out", format: "text", align: "right" },
    { key: "cancelled", label: "Cancelled", format: "text", align: "right" },
    { key: "noShow", label: "No-show", format: "text", align: "right" },
    { key: "roomNights", label: "Room-nights", format: "text", align: "right" },
  ];
  const tableRows: ReportRow[] = rows.map((r) => ({ property: nameOf(r.propertyId), total: r.total, confirmed: r.confirmed, inHouse: r.inHouse, checkedOut: r.checkedOut, cancelled: r.cancelled, noShow: r.noShow, roomNights: r.roomNights }));
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((n, r) => n + (r[k] as number), 0);
  const totalsRow: ReportRow = { property: "All properties", total: sum("total"), confirmed: sum("confirmed"), inHouse: sum("inHouse"), checkedOut: sum("checkedOut"), cancelled: sum("cancelled"), noShow: sum("noShow"), roomNights: sum("roomNights") };

  // Detailed register — one row per booking.
  const register = await bookingsRegister(user, { propertyIds, from, to });
  const regColumns: ReportColumn[] = [
    { key: "code", label: "Booking" },
    { key: "guest", label: "Guest" },
    { key: "property", label: "Property", format: "property" },
    { key: "source", label: "Source" },
    { key: "status", label: "Status" },
    { key: "checkIn", label: "Check-in" },
    { key: "checkOut", label: "Check-out" },
    { key: "nights", label: "Nights", format: "text", align: "right" },
    { key: "rate", label: "Rate/night", format: "money" },
  ];
  const regRows: ReportRow[] = register.map((b) => ({
    code: b.code, guest: b.guestName, property: nameOf(b.propertyId), source: sourceLabel(b.source), status: b.status,
    checkIn: b.checkInDate.toISOString().slice(0, 10), checkOut: b.checkOutDate.toISOString().slice(0, 10),
    nights: b.nights, rate: b.ratePaise,
  }));

  return (
    <div className="space-y-6">
      <ReportSection title={`Bookings · ${month}`} subtitle="Bookings in the period (by check-in date), per property and status." filename={`bookings-${month}.csv`} columns={columns} rows={tableRows} totalsRow={totalsRow} />
      <ReportSection title="Booking register · per booking" subtitle="Every booking in the period with guest, source, dates and rate — the detailed list." filename={`booking-register-${month}.csv`} columns={regColumns} rows={regRows} />
    </div>
  );
}

async function RoomsSection({ user, propertyIds, nameOf }: SectionInput & { nameOf: (id: string) => string }) {
  const rows = await roomsReport(user, { propertyIds });
  const columns: ReportColumn[] = [
    { key: "property", label: "Property", format: "property" },
    { key: "total", label: "Rooms", format: "text", align: "right" },
    { key: "active", label: "Active", format: "text", align: "right" },
    { key: "vacant", label: "Vacant", format: "text", align: "right" },
    { key: "occupied", label: "Occupied", format: "text", align: "right" },
    { key: "reserved", label: "Reserved", format: "text", align: "right" },
    { key: "maintenance", label: "Maintenance", format: "text", align: "right" },
    { key: "housekeeping", label: "Housekeeping", format: "text", align: "right" },
  ];
  const tableRows: ReportRow[] = rows.map((r) => ({ property: nameOf(r.propertyId), total: r.total, active: r.active, vacant: r.vacant, occupied: r.occupied, reserved: r.reserved, maintenance: r.maintenance, housekeeping: r.housekeeping }));
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((n, r) => n + (r[k] as number), 0);
  const totalsRow: ReportRow = { property: "All properties", total: sum("total"), active: sum("active"), vacant: sum("vacant"), occupied: sum("occupied"), reserved: sum("reserved"), maintenance: sum("maintenance"), housekeeping: sum("housekeeping") };
  return <ReportSection title="Rooms (current status)" subtitle="Current room inventory per property by status — a live snapshot, not month-scoped." filename="rooms-status.csv" columns={columns} rows={tableRows} totalsRow={totalsRow} />;
}

async function GstSection({ user, month, propertyIds, from, to, nameOf }: SectionInput & { nameOf: (id: string) => string }) {
  const rows = await gstReport(user, { propertyIds, from, to });
  const columns: ReportColumn[] = [
    { key: "property", label: "Property", format: "property" },
    { key: "taxable", label: "Taxable value", format: "money" },
    { key: "cgst", label: "CGST", format: "money" },
    { key: "sgst", label: "SGST", format: "money" },
    { key: "igst", label: "IGST", format: "money" },
    { key: "total", label: "Invoice total", format: "money" },
    { key: "count", label: "Invoices", format: "text", align: "right" },
  ];
  const tableRows: ReportRow[] = rows.map((r) => ({ property: nameOf(r.propertyId), taxable: r.taxablePaise, cgst: r.cgstPaise, sgst: r.sgstPaise, igst: r.igstPaise, total: r.totalPaise, count: r.invoiceCount }));
  const totalsRow: ReportRow = {
    property: "All properties",
    taxable: rows.reduce((n, r) => n + r.taxablePaise, 0),
    cgst: rows.reduce((n, r) => n + r.cgstPaise, 0),
    sgst: rows.reduce((n, r) => n + r.sgstPaise, 0),
    igst: rows.reduce((n, r) => n + r.igstPaise, 0),
    total: rows.reduce((n, r) => n + r.totalPaise, 0),
    count: rows.reduce((n, r) => n + r.invoiceCount, 0),
  };

  // Detailed register — one row per invoice with the full tax breakup.
  const register = await gstInvoiceRegister(user, { propertyIds, from, to });
  const regColumns: ReportColumn[] = [
    { key: "date", label: "Date" },
    { key: "number", label: "Invoice no." },
    { key: "type", label: "Type" },
    { key: "property", label: "Property", format: "property" },
    { key: "customer", label: "Customer" },
    { key: "gstin", label: "Customer GSTIN" },
    { key: "pos", label: "Place of supply" },
    { key: "taxable", label: "Taxable", format: "money" },
    { key: "cgst", label: "CGST", format: "money" },
    { key: "sgst", label: "SGST", format: "money" },
    { key: "igst", label: "IGST", format: "money" },
    { key: "total", label: "Total", format: "money" },
  ];
  const regRows: ReportRow[] = register.map((i) => ({
    date: i.issuedAt.toISOString().slice(0, 10), number: i.number, type: i.type === "CREDIT_NOTE" ? "Credit note" : "Tax invoice",
    property: nameOf(i.propertyId), customer: i.customerName, gstin: i.customerGstin ?? "", pos: i.placeOfSupply,
    taxable: i.taxablePaise, cgst: i.cgstPaise, sgst: i.sgstPaise, igst: i.igstPaise, total: i.totalPaise,
  }));
  const regTotals: ReportRow = {
    date: "", number: "", type: "", property: "Total", customer: "", gstin: "", pos: "",
    taxable: register.reduce((n, i) => n + i.taxablePaise, 0),
    cgst: register.reduce((n, i) => n + i.cgstPaise, 0),
    sgst: register.reduce((n, i) => n + i.sgstPaise, 0),
    igst: register.reduce((n, i) => n + i.igstPaise, 0),
    total: register.reduce((n, i) => n + i.totalPaise, 0),
  };

  return (
    <div className="space-y-6">
      <ReportSection title={`GST summary · ${month}`} subtitle="GST collected per property from issued invoices (credit notes net out originals)." filename={`gst-summary-${month}.csv`} columns={columns} rows={tableRows} totalsRow={totalsRow} />
      <ReportSection title="GST register · per invoice" subtitle="Every invoice with its CGST / SGST / IGST breakup — the detailed register for filing." filename={`gst-register-${month}.csv`} columns={regColumns} rows={regRows} totalsRow={regTotals} />
    </div>
  );
}

async function DuesSection({ user, propertyIds }: { user: SectionInput["user"]; propertyIds: string[] }) {
  const rollup = await perPropertyBillingRollup(user, propertyIds);
  const columns: ReportColumn[] = [
    { key: "property", label: "Property", format: "property" },
    { key: "outstanding", label: "Outstanding dues", format: "money" },
    { key: "unsettled", label: "Unsettled folios", format: "text", align: "right" },
    { key: "collectedToday", label: "Collected today", format: "money" },
    { key: "invoices", label: "Invoices (this month)", format: "text", align: "right" },
  ];
  const rows: ReportRow[] = rollup.rows.map((r) => ({ property: r.name, outstanding: r.outstandingPaise, unsettled: r.unsettledFolios, collectedToday: r.collectedTodayPaise, invoices: r.invoicesThisMonth }));
  const t = rollup.totals;
  const totalsRow: ReportRow = { property: "All properties", outstanding: t.outstandingPaise, unsettled: t.unsettledFolios, collectedToday: t.collectedTodayPaise, invoices: t.invoicesThisMonth };
  return (
    <ReportSection title="Outstanding dues (current)" subtitle="Live balance to collect per property — dues are a current figure, not month-scoped." filename="outstanding-dues.csv" columns={columns} rows={rows} totalsRow={totalsRow} />
  );
}

function ReportSection({ title, subtitle, filename, columns, rows, totalsRow }: { title: string; subtitle: string; filename: string; columns: ReportColumn[]; rows: ReportRow[]; totalsRow?: ReportRow }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <ExportTableButton filename={filename} columns={columns} rows={rows} totalsRow={totalsRow} />
      </div>
      <ReportTable columns={columns} rows={rows} totalsRow={totalsRow} />
    </section>
  );
}
