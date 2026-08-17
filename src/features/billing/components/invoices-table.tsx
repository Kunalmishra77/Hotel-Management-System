"use client";
/**
 * GST invoice register (Accounts/Reception) on the shared enterprise DataTable —
 * sortable, searchable, paginated. Money comes straight from the invoice query.
 */
import { FileText } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { formatINR } from "@/lib/utils";

export type InvoiceRow = {
  id: string;
  number: string;
  customerName: string;
  totalPaise: number;
  issuedAt: Date;
};

const fmtDate = (d: Date) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export function InvoicesTable({ invoices }: { invoices: InvoiceRow[] }) {
  const columns: Column<InvoiceRow>[] = [
    {
      key: "number",
      header: "Invoice",
      cell: (i) => <span className="font-mono text-sm font-medium">{i.number}</span>,
      sortValue: (i) => i.number,
    },
    {
      key: "customer",
      header: "Customer",
      cell: (i) => <span className="truncate">{i.customerName}</span>,
      sortValue: (i) => i.customerName.toLowerCase(),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (i) => <span className="tabular font-medium">{formatINR(i.totalPaise)}</span>,
      sortValue: (i) => i.totalPaise,
    },
    {
      key: "issued",
      header: "Issued",
      align: "right",
      cell: (i) => <span className="tabular text-muted-foreground">{fmtDate(new Date(i.issuedAt))}</span>,
      sortValue: (i) => new Date(i.issuedAt).getTime(),
      hideBelow: "sm",
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={invoices}
      getRowKey={(i) => i.id}
      searchable={{ placeholder: "Search invoice no. or customer…", accessor: (i) => `${i.number} ${i.customerName}` }}
      initialSort={{ key: "issued", dir: "desc" }}
      pageSize={12}
      empty={
        <div className="text-muted-foreground">
          <FileText className="mx-auto size-6" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-foreground">No invoices yet</p>
          <p className="mt-1 text-sm">A GST tax invoice is issued from a guest&apos;s folio at settlement.</p>
        </div>
      }
    />
  );
}
