"use client";
/**
 * Guest CRM table (Reception) — the enterprise list for the guest directory:
 * masked contact, loyalty tier, company and city, sortable and paginated. Every
 * row opens the profile (where revealing a number is a separate audited action).
 * Names stay visible so the desk can identify a guest; contact is masked.
 */
import { Phone, Building2 } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { formatINR } from "@/lib/utils";
import type { GuestListItem } from "../queries";
import type { GuestTierInfo } from "@/features/guest-history/domain/tier";
import type { GuestStat } from "@/features/guest-history/queries";

const TIER_VARIANT: Record<string, "brass" | "secondary"> = { VIP: "brass", REPEAT: "secondary" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtLastStay(d: Date | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()] ?? ""} ${String(dt.getUTCFullYear()).slice(2)}`;
}

export function GuestsTable({
  guests,
  tiers = {},
  stats = {},
}: {
  guests: GuestListItem[];
  tiers?: Record<string, GuestTierInfo>;
  stats?: Record<string, GuestStat>;
}) {
  const columns: Column<GuestListItem>[] = [
    {
      key: "name",
      header: "Guest",
      cell: (g) => {
        const t = tiers[g.id];
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold text-foreground">{g.fullName}</span>
              {t && t.tier !== "NEW" ? (
                <Badge variant={TIER_VARIANT[t.tier] ?? "secondary"} className="text-[0.65rem]">{t.label}</Badge>
              ) : null}
            </div>
            {g.companyName ? (
              <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Building2 className="size-3" aria-hidden="true" /> {g.companyName}
              </div>
            ) : null}
          </div>
        );
      },
      sortValue: (g) => g.fullName.toLowerCase(),
    },
    {
      key: "mobile",
      header: "Mobile",
      cell: (g) =>
        g.maskedMobile ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-muted-foreground">
            <Phone className="size-3.5" aria-hidden="true" /> {g.maskedMobile}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      hideBelow: "sm",
    },
    {
      key: "visits",
      header: "Visits",
      align: "right",
      cell: (g) => {
        const s = stats[g.id];
        return s && s.visits > 0
          ? <span className="tabular font-medium">{s.visits}<span className="ml-1 text-xs font-normal text-muted-foreground">· {s.roomNights}n</span></span>
          : <span className="text-xs text-muted-foreground">—</span>;
      },
      sortValue: (g) => stats[g.id]?.visits ?? 0,
      hideBelow: "md",
    },
    {
      key: "spend",
      header: "Lifetime spend",
      align: "right",
      cell: (g) => {
        const s = stats[g.id];
        if (!s || s.revenuePaise === null) return <span className="text-xs text-muted-foreground">—</span>;
        return <span className="tabular font-semibold">{formatINR(s.revenuePaise)}</span>;
      },
      sortValue: (g) => stats[g.id]?.revenuePaise ?? 0,
      hideBelow: "sm",
    },
    {
      key: "lastStay",
      header: "Last stay",
      align: "right",
      cell: (g) => <span className="text-muted-foreground">{fmtLastStay(stats[g.id]?.lastStayAt ?? null)}</span>,
      sortValue: (g) => stats[g.id]?.lastStayAt ? new Date(stats[g.id]!.lastStayAt!).getTime() : 0,
      hideBelow: "lg",
    },
    {
      key: "outstanding",
      header: "Outstanding",
      align: "right",
      cell: (g) => {
        const s = stats[g.id];
        if (!s || s.outstandingPaise === null) return <span className="text-xs text-muted-foreground">—</span>;
        return s.outstandingPaise > 0
          ? <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">{formatINR(s.outstandingPaise)}</span>
          : <span className="text-xs text-success">Clear</span>;
      },
      sortValue: (g) => stats[g.id]?.outstandingPaise ?? 0,
      hideBelow: "lg",
    },
    {
      key: "tier",
      header: "Segment",
      align: "right",
      cell: (g) => {
        const t = tiers[g.id];
        return t && t.tier !== "NEW" ? (
          <Badge variant={TIER_VARIANT[t.tier] ?? "secondary"} className="text-[0.65rem]">{t.label}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">New</span>
        );
      },
      hideBelow: "sm",
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={guests}
      getRowKey={(g) => g.id}
      getRowHref={(g) => `/guests/${g.id}`}
      initialSort={{ key: "name", dir: "asc" }}
      pageSize={12}
    />
  );
}
