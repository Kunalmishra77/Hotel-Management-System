"use client";
/**
 * Open / recent folios on the Billing home — the in-house & unsettled accounts a
 * checked-in stay lands in BEFORE a GST invoice is issued. Sortable/searchable
 * DataTable; a row opens that booking's folio. Money comes straight from the
 * folio query (derived balance) — never recomputed here.
 */
import { Wallet } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import type { BillingFolioRow } from "@/features/billing/queries";
import { formatINR } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  IN_HOUSE: "In-house",
  CHECKED_OUT: "Checked out",
  CONFIRMED: "Confirmed",
  RESERVATION: "Reservation",
  DIRECT_SALE: "Direct sale",
};

function StatusBadge({ status, hasBalance }: { status: string; hasBalance: boolean }) {
  const label = STATUS_LABEL[status] ?? status;
  const tone = hasBalance
    ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
    : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{label}</span>;
}

export function OpenFoliosTable({ folios }: { folios: BillingFolioRow[] }) {
  const columns: Column<BillingFolioRow>[] = [
    {
      key: "code",
      header: "Booking",
      cell: (f) => <span className="font-mono text-sm font-medium">{f.code}</span>,
      sortValue: (f) => f.code,
    },
    {
      key: "guest",
      header: "Guest",
      cell: (f) => <span className="truncate">{f.guestName}</span>,
      sortValue: (f) => f.guestName.toLowerCase(),
    },
    {
      key: "status",
      header: "Status",
      cell: (f) => <StatusBadge status={f.status} hasBalance={f.balancePaise > 0} />,
      sortValue: (f) => f.status,
      hideBelow: "sm",
    },
    {
      key: "charges",
      header: "Charges",
      align: "right",
      cell: (f) => <span className="tabular text-muted-foreground">{formatINR(f.chargesPaise)}</span>,
      sortValue: (f) => f.chargesPaise,
      hideBelow: "md",
    },
    {
      key: "paid",
      header: "Paid",
      align: "right",
      cell: (f) => <span className="tabular text-muted-foreground">{formatINR(f.paidPaise)}</span>,
      sortValue: (f) => f.paidPaise,
      hideBelow: "md",
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      cell: (f) => (
        <span className={`tabular font-semibold ${f.balancePaise > 0 ? "text-amber-700 dark:text-amber-400" : "text-foreground"}`}>
          {formatINR(f.balancePaise)}
        </span>
      ),
      sortValue: (f) => f.balancePaise,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={folios}
      getRowKey={(f) => f.folioId}
      getRowHref={(f) => (f.reservationId ? `/bookings/${f.reservationId}/folio` : "")}
      searchable={{ placeholder: "Search booking or guest…", accessor: (f) => `${f.code} ${f.guestName}` }}
      pageSize={12}
      empty={
        <div className="text-muted-foreground">
          <Wallet className="mx-auto size-6" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-foreground">No open accounts</p>
          <p className="mt-1 text-sm">A folio appears here as soon as a guest is checked in or charged.</p>
        </div>
      }
    />
  );
}
