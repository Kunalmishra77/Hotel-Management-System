import type { Metadata } from "next";
import Link from "next/link";
import { Users, UserPlus, Building2 } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { searchGuests, guestsOverview } from "@/features/guests/queries";
import { GuestSearchBox } from "@/features/guests/components/guest-search-box";
import { GuestList } from "@/features/guests/components/guest-list";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Guests" };

/**
 * 04 — the guest CRM landing. Search is the hot path (masked, indexed), but the
 * page is no longer empty before you type: CRM totals (guests, new this month,
 * corporate) plus the most recently added guests give immediate, useful content.
 * `guest:view`; results masked; reveal is a separate audited action on the profile.
 */
export default async function GuestsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  // FR-15: enforced server-side — hiding the nav item is not security.
  const user = await requirePermission("guest:view");
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  // Only hit the search index once there's something to look for. Always load the
  // lightweight overview (cheap indexed counts + 8 recent rows).
  const [results, overview] = await Promise.all([
    query ? searchGuests(user, { query, limit: 25 }) : Promise.resolve({ guests: [], nextCursor: null }),
    guestsOverview(user),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader
        title="Guests"
        description="Permanent CRM — searchable across every property"
        actions={
          <Button asChild size="sm">
            <Link href="/guests/new" data-testid="new-guest-link"><UserPlus className="mr-1.5 size-4" />New guest</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Total guests" value={overview.total.toLocaleString("en-IN")} icon={<Users />} hint="In the CRM" />
        <KpiCard label="New this month" value={overview.newThisMonth.toLocaleString("en-IN")} icon={<UserPlus />} />
        <KpiCard label="Corporate" value={overview.withCompany.toLocaleString("en-IN")} icon={<Building2 />} hint="With company" />
      </div>

      <div className="mt-4">
        <GuestSearchBox initialQuery={query} />
      </div>

      <div className="mt-3">
        {query ? (
          <GuestList guests={results.guests} query={query} />
        ) : (
          <>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Recently added</h2>
            <GuestList guests={overview.recent} query="" />
          </>
        )}
      </div>
    </div>
  );
}
