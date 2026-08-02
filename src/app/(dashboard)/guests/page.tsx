import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/guard";
import { searchGuests } from "@/features/guests/queries";
import { GuestSearchBox } from "@/features/guests/components/guest-search-box";
import { GuestList } from "@/features/guests/components/guest-list";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Guests" };

/** 04 T-18 — guest search/list (FR-8/10, AC-7/AC-10). Results are masked. */
export default async function GuestsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  // FR-15: enforced server-side — hiding the nav item is not security.
  const user = await requirePermission("guest:view");
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  // Only hit the DB once there's something to look for — an empty search should
  // not stream the whole book of guests.
  const results = query ? await searchGuests(user, { query, limit: 25 }) : { guests: [], nextCursor: null };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Guests</h1>
        <Button asChild size="sm">
          <Link href="/guests/new" data-testid="new-guest-link">New guest</Link>
        </Button>
      </div>

      <GuestSearchBox initialQuery={query} />
      <GuestList guests={results.guests} query={query} />
    </div>
  );
}
