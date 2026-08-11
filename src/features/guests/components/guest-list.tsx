/**
 * Guest results list — 04 T-18 (FR-8, AC-7).
 *
 * Presentational and server-rendered. Every row is MASKED: name is visible so
 * the front desk can identify the guest; contact is masked. Revealing a number
 * is a separate, audited action on the profile — never the list.
 *
 * Mobile-first: rows are tap targets (≥44px) that collapse to a stacked card on
 * a phone and read as a table row on wider screens.
 */
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { GuestListItem } from "../queries";
import type { GuestTierInfo } from "@/features/guest-history/domain/tier";

const TIER_VARIANT: Record<string, "brass" | "secondary"> = { VIP: "brass", REPEAT: "secondary" };

export function GuestList({
  guests,
  query,
  tiers = {},
}: {
  guests: GuestListItem[];
  query: string;
  tiers?: Record<string, GuestTierInfo>;
}) {
  if (guests.length === 0) {
    return (
      <p className="rounded-md border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
        {query
          ? `No guests match “${query}”.`
          : "Search for a guest by name, mobile, email, company or GSTIN."}
      </p>
    );
  }

  return (
    <ul className="divide-y rounded-md border" data-testid="guest-results">
      {guests.map((g) => (
        <li key={g.id}>
          <Link
            href={`/guests/${g.id}`}
            className="flex min-h-11 flex-col gap-0.5 p-3 hover:bg-muted/50 focus:bg-muted/50 focus:outline-none sm:flex-row sm:items-center sm:justify-between"
            data-testid="guest-row"
          >
            <span className="flex items-center gap-2 font-medium">
              {g.fullName}
              {tiers[g.id] && tiers[g.id]!.tier !== "NEW" ? (
                <Badge variant={TIER_VARIANT[tiers[g.id]!.tier] ?? "secondary"} className="text-[0.65rem]">
                  {tiers[g.id]!.label}
                </Badge>
              ) : null}
            </span>
            <span className="text-sm text-muted-foreground">
              {g.maskedMobile ?? "—"}
              {g.city ? ` · ${g.city}` : ""}
              {g.companyName ? ` · ${g.companyName}` : ""}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
