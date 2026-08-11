import type { Metadata } from "next";
import Link from "next/link";
import { Users, UserPlus, Building2 } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { searchGuests, guestsOverview, guestsBySegment, type GuestSegment } from "@/features/guests/queries";
import { guestTiers } from "@/features/guest-history/queries";
import { GuestSearchBox } from "@/features/guests/components/guest-search-box";
import { GuestList } from "@/features/guests/components/guest-list";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Guests" };

const SEGMENTS: { key: string; label: string }[] = [
  { key: "", label: "Recent" },
  { key: "vip", label: "VIP" },
  { key: "repeat", label: "Repeat" },
  { key: "corporate", label: "Corporate" },
];
const SEGMENT_HEADING: Record<string, string> = {
  vip: "VIP guests",
  repeat: "Repeat guests",
  corporate: "Corporate guests",
};
const isSegment = (v: string): v is GuestSegment => v === "vip" || v === "repeat" || v === "corporate";

/**
 * 04 — the guest CRM landing. Search is the hot path (masked, indexed). Before you
 * search, the page shows CRM totals plus a browsable list: recently added by
 * default, or filtered to a segment (VIP / Repeat / Corporate) via the chips.
 * `guest:view`; results masked; reveal is a separate audited action on the profile.
 */
export default async function GuestsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; segment?: string }>;
}) {
  // FR-15: enforced server-side — hiding the nav item is not security.
  const user = await requirePermission("guest:view");
  const sp = await searchParams;
  const query = (sp.q ?? "").trim();
  const segParam = (sp.segment ?? "").trim();
  const segment = isSegment(segParam) ? segParam : null;

  const [overview, listed] = await Promise.all([
    guestsOverview(user),
    query
      ? searchGuests(user, { query, limit: 25 }).then((r) => r.guests)
      : segment
        ? guestsBySegment(user, { segment, limit: 24 })
        : Promise.resolve(null),
  ]);

  const displayed = listed ?? overview.recent;
  const tiers = await guestTiers(user, displayed.map((g) => g.id));

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

      {/* Segment filter chips (ignored while a search is active) */}
      <div className="mt-3 flex flex-wrap gap-2" data-testid="segment-chips">
        {SEGMENTS.map((s) => {
          const active = !query && (segment ?? "") === s.key;
          return (
            <Link
              key={s.key || "recent"}
              href={s.key ? `/guests?segment=${s.key}` : "/guests"}
              data-testid={`segment-${s.key || "recent"}`}
              className={cn(
                "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {s.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-3">
        {query ? (
          <GuestList guests={displayed} query={query} tiers={tiers} />
        ) : (
          <>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
              {segment ? SEGMENT_HEADING[segment] : "Recently added"}
            </h2>
            <GuestList guests={displayed} query="" tiers={tiers} />
          </>
        )}
      </div>
    </div>
  );
}
