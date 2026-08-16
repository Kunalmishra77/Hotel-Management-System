"use client";
/**
 * Guest CRM table (Reception) — the enterprise list for the guest directory:
 * masked contact, loyalty tier, company and city, sortable and paginated. Every
 * row opens the profile (where revealing a number is a separate audited action).
 * Names stay visible so the desk can identify a guest; contact is masked.
 */
import { Phone, Mail, Building2 } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import type { GuestListItem } from "../queries";
import type { GuestTierInfo } from "@/features/guest-history/domain/tier";

const TIER_VARIANT: Record<string, "brass" | "secondary"> = { VIP: "brass", REPEAT: "secondary" };

export function GuestsTable({
  guests,
  tiers = {},
}: {
  guests: GuestListItem[];
  tiers?: Record<string, GuestTierInfo>;
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
      key: "email",
      header: "Email",
      cell: (g) =>
        g.maskedEmail ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-muted-foreground">
            <Mail className="size-3.5" aria-hidden="true" /> {g.maskedEmail}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      hideBelow: "lg",
    },
    {
      key: "city",
      header: "City",
      cell: (g) => g.city ?? <span className="text-muted-foreground">—</span>,
      sortValue: (g) => g.city ?? "~",
      hideBelow: "md",
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
