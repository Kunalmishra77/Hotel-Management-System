"use client";
/**
 * Property league table — rank every property side by side on occupancy, ADR,
 * RevPAR and revenue, sortable by any column. The multi-property owner's "which
 * hotel is winning" view. Each row drills into that property's command centre.
 */
import { DataTable, type Column } from "@/components/ui/data-table";
import { formatINR, cn } from "@/lib/utils";
import { propertyColor } from "@/lib/property-colors";
import type { PortfolioProperty } from "../queries";

const pct = (bps: number) => `${Math.round(bps / 100)}%`;

export function PortfolioLeague({ properties }: { properties: PortfolioProperty[] }) {
  const columns: Column<PortfolioProperty>[] = [
    {
      key: "name",
      header: "Property",
      cell: (p) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate font-semibold text-foreground">
            <span className={cn("size-2 shrink-0 rounded-full", propertyColor(p.name).dot)} aria-hidden="true" />{p.name}
          </div>
          <div className="text-xs text-muted-foreground">{p.city} · {p.code}</div>
        </div>
      ),
      sortValue: (p) => p.name.toLowerCase(),
    },
    {
      key: "occ",
      header: "Occupancy",
      align: "right",
      cell: (p) => <span className="tabular">{pct(p.occupancyBps)}</span>,
      sortValue: (p) => p.occupancyBps,
    },
    {
      key: "adr",
      header: "ADR",
      align: "right",
      cell: (p) => <span className="tabular">{formatINR(p.adrPaise)}</span>,
      sortValue: (p) => p.adrPaise,
      hideBelow: "sm",
    },
    {
      key: "revpar",
      header: "RevPAR",
      align: "right",
      cell: (p) => <span className="tabular">{formatINR(p.revparPaise)}</span>,
      sortValue: (p) => p.revparPaise,
      hideBelow: "md",
    },
    {
      key: "rev",
      header: "Revenue",
      align: "right",
      cell: (p) => <span className="tabular font-semibold">{formatINR(p.revenuePaise)}</span>,
      sortValue: (p) => p.revenuePaise,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={properties}
      getRowKey={(p) => p.id}
      getRowHref={(p) => `/overview/${p.id}`}
      searchable={{ placeholder: "Search property…", accessor: (p) => `${p.name} ${p.city} ${p.code}` }}
      initialSort={{ key: "rev", dir: "desc" }}
      pageSize={10}
    />
  );
}
