import type { Metadata } from "next";
import { localToday } from "@/lib/local-day";
import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/permissions";
import { NoProperty } from "@/features/platform/components/no-property";
import { profitReport, revenueSegments, bookingsReport, roomsReport, gstReport, gstInvoiceRegister } from "@/features/reports/queries";
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
import { bookingRegister, collectionsRegister, channelDeductionRules, companyDues, type RegisterBasis, type BookingRegisterEntry } from "@/features/reports/register-queries";
import { OtaDeductionSettings } from "@/features/reports/components/ota-deduction-settings";
import { otaDeduction, addDeduction, ZERO_DEDUCTION, type Deduction } from "@/features/reports/domain/ota-deduction";
import { BookingRegisterView } from "@/features/reports/components/booking-register-view";
import { CollectionsView } from "@/features/reports/components/collections-view";
import Link from "next/link";
import { formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Reports" };

const MONTH_RE = /^\d{4}-\d{2}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const BASES: { key: RegisterBasis; label: string }[] = [
  { key: "checkin", label: "Check-in in the period" },
  { key: "stay", label: "Staying any night in the period" },
  { key: "booked", label: "Booked in the period" },
];
const monthEnd = (month: string): Date => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0));
};
const isReport = (v: string | undefined): v is ReportType => REPORT_TYPES.some((t) => t.key === v);

const SOURCE_LABEL: Record<string, string> = {
  WALK_IN: "Walk-in", DIRECT: "Direct", WEBSITE: "Website", PHONE: "Phone", CORPORATE: "Corporate",
  TRAVEL_AGENT: "Travel agent", BOOKING_COM: "Booking.com", MAKEMYTRIP: "MakeMyTrip", EXPEDIA: "Expedia", GOIBIBO: "Goibibo",
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
  searchParams: Promise<{ report?: string; month?: string; properties?: string; from?: string; to?: string; basis?: string }>;
}) {
  const user = await requirePermission("report:view-financial");
  const properties = await listAccessibleProperties();
  if (properties.length === 0) {
    return <NoProperty what="This page" canCreate={hasPermission(user, "property:manage")} />;
  }
  const accessibleIds = properties.map((p) => p.id);
  const nameOf = (id: string): string => properties.find((p) => p.id === id)?.name ?? id;

  const sp = await searchParams;
  const currentMonth = localToday().toISOString().slice(0, 7); // India-time month
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

  // A custom range (from/to) overrides the month.
  const range = sp.from && sp.to && DAY_RE.test(sp.from) && DAY_RE.test(sp.to) && sp.from <= sp.to ? { from: sp.from, to: sp.to } : null;
  const from = range ? new Date(`${range.from}T00:00:00.000Z`) : new Date(`${month}-01T00:00:00.000Z`);
  const to = range ? new Date(`${range.to}T00:00:00.000Z`) : month === currentMonth ? localToday() : monthEnd(month);
  const periodLabel = range ? `${range.from} to ${range.to}` : month;
  const basis: RegisterBasis = BASES.some((b) => b.key === sp.basis) ? (sp.basis as RegisterBasis) : "checkin";
  const keep = new URLSearchParams();
  if (range) { keep.set("from", range.from); keep.set("to", range.to); } else keep.set("month", month);
  if (propsParam) keep.set("properties", propsParam);

  const scopeLabel = propertyIds.length === 1
    ? (properties.find((p) => p.id === propertyIds[0])?.name ?? "1 property")
    : `All properties (${propertyIds.length})`;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
      <ReportsFilterBar properties={properties} selected={propertyIds} month={month} range={range} />
      <ReportTabs active={reportType} query={keep.toString()} />

      {reportType === "profit" ? (
        await ProfitSection({ user, month, propertyIds, from, to, scopeLabel, propertyCount: propertyIds.length, overheadPropertyIds })
      ) : reportType === "occupancy" ? (
        await OccupancySection({ user, month: periodLabel, propertyIds, from, to })
      ) : reportType === "bookings" ? (
        await BookingsSection({ user, month: periodLabel, propertyIds, from, to, nameOf, basis, keep: keep.toString() })
      ) : reportType === "companies" ? (
        await CompanyDuesSection({ user, propertyIds, nameOf })
      ) : reportType === "collections" ? (
        await CollectionsSection({ user, month: periodLabel, propertyIds, from, to, nameOf })
      ) : reportType === "rooms" ? (
        await RoomsSection({ user, month, propertyIds, from, to, nameOf })
      ) : reportType === "source" ? (
        await SourceSection({ user, month: periodLabel, propertyIds, from, to })
      ) : reportType === "gst" ? (
        await GstSection({ user, month: periodLabel, propertyIds, from, to, nameOf })
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
  const [segments, register, rules] = await Promise.all([
    revenueSegments(user, { propertyIds, from, to }),
    bookingRegister(user, { propertyIds, from, to, basis: "checkin" }),
    channelDeductionRules(user),
  ]);
  const channelRows = channelPerformance(register);
  // What each OTA kept: per booking, on the nights that channel sold (cancelled /
  // no-show bookings with no charges add nothing).
  const byOta = new Map<string, Deduction & { bookings: number }>();
  for (const r of register) {
    for (const part of r.otaParts) {
      const rule = rules[part.source];
      if (!rule || part.basePaise <= 0) continue;
      const prev = byOta.get(part.source) ?? { ...ZERO_DEDUCTION, bookings: 0 };
      byOta.set(part.source, { ...addDeduction(prev, otaDeduction(part.basePaise, part.gstPaise, rule)), bookings: prev.bookings + 1 });
    }
  }
  const otaRows: ReportRow[] = [...byOta.entries()].map(([src, d]) => ({
    source: sourceLabel(src) + (rules[src]?.set ? "" : " (commission not set)"), bookings: d.bookings, gross: d.grossPaise, commission: d.commissionPaise, extra: d.extraFeePaise,
    gst: d.gstOnCommissionPaise, tcs: d.tcsPaise, tds: d.tdsPaise, deduction: d.deductionPaise, net: d.netPaise,
  }));
  const otaTotal = [...byOta.values()].reduce((a, d) => ({ ...addDeduction(a, d), bookings: a.bookings + d.bookings }), { ...ZERO_DEDUCTION, bookings: 0 });
  const otaColumns: ReportColumn[] = [
    { key: "source", label: "Channel" }, { key: "bookings", label: "Bookings", format: "text", align: "right" },
    { key: "gross", label: "Sale incl. GST", format: "money" }, { key: "commission", label: "Commission", format: "money" },
    { key: "extra", label: "Other fee", format: "money" },
    { key: "gst", label: "GST on commission", format: "money" }, { key: "tcs", label: "TCS", format: "money" }, { key: "tds", label: "TDS", format: "money" },
    { key: "deduction", label: "OTA keeps", format: "money" }, { key: "net", label: "Net to hotel", format: "money" },
  ];
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
      <ReportSection title={`What each OTA keeps · ${month}`} subtitle="Per channel, on the nights it sold: commission, GST on commission (input credit), TCS and TDS (tax credit), and what reaches the hotel. Rates from the settings below." filename={`ota-deductions-${month}.csv`} columns={otaColumns} rows={otaRows}
        totalsRow={{ source: "All OTAs", bookings: otaTotal.bookings, gross: otaTotal.grossPaise, commission: otaTotal.commissionPaise, extra: otaTotal.extraFeePaise, gst: otaTotal.gstOnCommissionPaise, tcs: otaTotal.tcsPaise, tds: otaTotal.tdsPaise, deduction: otaTotal.deductionPaise, net: otaTotal.netPaise }} />
      <OtaDeductionSettings rules={rules} canEdit={hasPermission(user, "settings:manage")} />
      <ReportSection title={`Bookings by channel · ${month}`} subtitle="Bookings checking in during the period, per channel: cancellations, room-nights, billed and still due." filename={`channels-${month}.csv`} columns={CHANNEL_COLUMNS} rows={channelRows.rows} totalsRow={channelRows.totals} />
      <ReportSection title={`Revenue by source · ${month}`} subtitle="Where the period's revenue came from (net of discounts, ex-tax)." filename={`revenue-by-source-${month}.csv`} columns={columns} rows={rows} totalsRow={totalsRow} />
      {corpRows.length > 0 ? (
        <ReportSection title="Top corporate clients & travel agents" subtitle="By revenue over the period." filename={`corporate-revenue-${month}.csv`} columns={corpColumns} rows={corpRows} />
      ) : null}
    </>
  );
}

async function BookingsSection({ user, month, propertyIds, from, to, nameOf, basis, keep }: SectionInput & { nameOf: (id: string) => string; basis: RegisterBasis; keep: string }) {
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

  // The detailed register — one row per booking with its money (folio truth).
  const register = await bookingRegister(user, { propertyIds, from, to, basis });
  const names = Object.fromEntries(propertyIds.map((id) => [id, nameOf(id)]));

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Booking register · {month}</h2>
          <p className="text-sm text-muted-foreground">Every booking with its bill, payments, balance and invoice number. Click a booking to open it.</p>
        </div>
        <nav className="flex flex-wrap gap-1.5" aria-label="Which bookings">
          {BASES.map((b) => (
            <Link key={b.key} href={`/reports?report=bookings&${keep}&basis=${b.key}`} aria-current={b.key === basis ? "page" : undefined}
              className={`min-h-touch inline-flex items-center rounded-full border px-3 text-sm ${b.key === basis ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {b.label}
            </Link>
          ))}
        </nav>
        <BookingRegisterView rows={register} propertyNames={names} filename={`booking-register-${month}.csv`} />
      </section>
      <ReportSection title={`Bookings by hotel · ${month}`} subtitle="Bookings checking in during the period, per hotel and status." filename={`bookings-${month}.csv`} columns={columns} rows={tableRows} totalsRow={totalsRow} />
    </div>
  );
}

async function CollectionsSection({ user, month, propertyIds, from, to, nameOf }: SectionInput & { nameOf: (id: string) => string }) {
  const rows = await collectionsRegister(user, { propertyIds, from, to });
  const names = Object.fromEntries(propertyIds.map((id) => [id, nameOf(id)]));
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">Daily collections · {month}</h2>
        <p className="text-sm text-muted-foreground">Every payment and refund received — by mode, by day, and who received it. Use it to match the cash drawer each evening.</p>
      </div>
      <CollectionsView rows={rows} propertyNames={names} filename={`collections-${month}.csv`} />
    </section>
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

  // GSTR-1 split: B2B = invoices to a GSTIN holder; B2C = everyone else.
  const split = (b2b: boolean) => register.filter((i) => !!i.customerGstin === b2b);
  const splitRow = (label: string, list: typeof register): ReportRow => ({
    kind: label, count: list.filter((i) => i.type !== "CREDIT_NOTE").length,
    taxable: list.reduce((n, i) => n + i.taxablePaise, 0), cgst: list.reduce((n, i) => n + i.cgstPaise, 0),
    sgst: list.reduce((n, i) => n + i.sgstPaise, 0), igst: list.reduce((n, i) => n + i.igstPaise, 0), total: list.reduce((n, i) => n + i.totalPaise, 0),
  });
  const splitColumns: ReportColumn[] = [
    { key: "kind", label: "Type" }, { key: "count", label: "Invoices", format: "text", align: "right" }, { key: "taxable", label: "Taxable", format: "money" },
    { key: "cgst", label: "CGST", format: "money" }, { key: "sgst", label: "SGST", format: "money" }, { key: "igst", label: "IGST", format: "money" }, { key: "total", label: "Total", format: "money" },
  ];
  return (
    <div className="space-y-6">
      <ReportSection title={`B2B vs B2C · ${month}`} subtitle="For GSTR-1: company bills with a GSTIN (B2B) and all other bills (B2C). Corrected bills count once, at their current version." filename={`gst-b2b-b2c-${month}.csv`} columns={splitColumns} rows={[splitRow("B2B (with GSTIN)", split(true)), splitRow("B2C", split(false))]} totalsRow={splitRow("Total", register)} />
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

const CHANNEL_COLUMNS: ReportColumn[] = [
  { key: "source", label: "Channel" },
  { key: "bookings", label: "Bookings", format: "text", align: "right" },
  { key: "cancelled", label: "Cancelled", format: "text", align: "right" },
  { key: "noShow", label: "No-show", format: "text", align: "right" },
  { key: "roomNights", label: "Room-nights", format: "text", align: "right" },
  { key: "charges", label: "Billed (ex-GST)", format: "money" },
  { key: "avg", label: "Avg / room-night", format: "money" },
  { key: "paid", label: "Paid", format: "money" },
  { key: "due", label: "Still due", format: "money" },
];

/** Per-channel performance of the period's bookings (from the booking register). */
function channelPerformance(register: BookingRegisterEntry[]): { rows: ReportRow[]; totals: ReportRow } {
  type Acc = { bookings: number; cancelled: number; noShow: number; roomNights: number; charges: number; paid: number; due: number };
  const zero = (): Acc => ({ bookings: 0, cancelled: 0, noShow: 0, roomNights: 0, charges: 0, paid: 0, due: 0 });
  const by = new Map<string, Acc>();
  const all = zero();
  for (const r of register) {
    for (const a of [by.get(r.source) ?? zero(), all]) {
      a.bookings += 1;
      if (r.status === "CANCELLED") a.cancelled += 1;
      else if (r.status === "NO_SHOW") a.noShow += 1;
      else a.roomNights += r.nights;
      a.charges += r.chargesPaise; a.paid += r.paidPaise; a.due += Math.max(0, r.balancePaise);
      if (a !== all) by.set(r.source, a);
    }
  }
  const row = (source: string, a: Acc): ReportRow => ({ source, ...a, avg: a.roomNights ? Math.round(a.charges / a.roomNights) : 0 });
  return {
    rows: [...by.entries()].sort((x, y) => y[1].charges - x[1].charges).map(([k, a]) => row(sourceLabel(k), a)),
    totals: row("All channels", all),
  };
}

async function CompanyDuesSection({ user, propertyIds, nameOf }: { user: SectionInput["user"]; propertyIds: string[]; nameOf: (id: string) => string }) {
  const items = await companyDues(user, { propertyIds });
  const byCompany = new Map<string, { gstin: string | null; count: number; bill: number; paid: number; due: number; oldest: string }>();
  for (const i of items) {
    const a = byCompany.get(i.company) ?? { gstin: i.gstin, count: 0, bill: 0, paid: 0, due: 0, oldest: i.date };
    a.count += 1; a.bill += i.billPaise; a.paid += i.paidPaise; a.due += i.duePaise;
    if (i.date < a.oldest) a.oldest = i.date;
    byCompany.set(i.company, a);
  }
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const daysSince = (d: string) => Math.max(0, Math.round((Date.parse(today) - Date.parse(d)) / 86_400_000));
  const columns: ReportColumn[] = [
    { key: "company", label: "Company" }, { key: "gstin", label: "GSTIN" }, { key: "count", label: "Bills", format: "text", align: "right" },
    { key: "bill", label: "Billed", format: "money" }, { key: "paid", label: "Received", format: "money" }, { key: "due", label: "Due", format: "money" },
    { key: "oldest", label: "Oldest since" },
  ];
  const rows: ReportRow[] = [...byCompany.entries()].sort((a, b) => b[1].due - a[1].due).map(([company, a]) => ({
    company, gstin: a.gstin ?? "", count: a.count, bill: a.bill, paid: a.paid, due: a.due, oldest: `${a.oldest} (${daysSince(a.oldest)} days)`,
  }));
  const total = items.reduce((n, i) => n + i.duePaise, 0);
  const detailColumns: ReportColumn[] = [
    { key: "company", label: "Company" }, { key: "label", label: "Booking / bill" }, { key: "property", label: "Hotel", format: "property" },
    { key: "date", label: "Date" }, { key: "bill", label: "Bill", format: "money" }, { key: "paid", label: "Received", format: "money" }, { key: "due", label: "Due", format: "money" },
  ];
  const detailRows: ReportRow[] = items.map((i) => ({ company: i.company, label: i.label, property: nameOf(i.propertyId), date: i.date, bill: i.billPaise, paid: i.paidPaise, due: i.duePaise }));
  return (
    <div className="space-y-6">
      <ReportSection title="Company dues (current)" subtitle="What each credit company still owes — stays on company credit and unpaid manual bills. When a company pays, record it with Take payment on the booking." filename="company-dues.csv" columns={columns} rows={rows} totalsRow={{ company: "All companies", due: total, count: items.length }} />
      {items.length > 0 ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Every bill due</h3>
            <ExportTableButton filename="company-dues-detail.csv" columns={detailColumns} rows={detailRows} />
          </div>
          <ul className="divide-y rounded-lg border text-sm">
            {items.map((i) => (
              <li key={i.reservationId ?? i.invoiceId ?? i.label} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  <span className="font-medium">{i.company}</span>{" · "}
                  {i.reservationId ? <Link href={`/bookings/${i.reservationId}`} className="text-primary underline-offset-2 hover:underline">{i.label}</Link>
                    : i.invoiceId ? <Link href={`/billing/manual?invoice=${i.invoiceId}`} className="text-primary underline-offset-2 hover:underline">{i.label}</Link> : i.label}
                  <span className="text-muted-foreground"> · {nameOf(i.propertyId)} · {i.date}</span>
                </span>
                <span className="font-medium tabular-nums text-destructive">{formatINR(i.duePaise)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
