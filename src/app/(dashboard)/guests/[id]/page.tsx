import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { getGuestProfile } from "@/features/guests/queries";
import { GuestProfile } from "@/features/guests/components/guest-profile";
import { getGuestHistory } from "@/features/guest-history/queries";
import { guestTier } from "@/features/guest-history/domain/tier";
import { GuestHistorySection } from "@/features/guest-history/components/guest-history-section";

export const metadata: Metadata = { title: "Guest" };

/** 04 T-19 profile + 05 T-9 history section (04 FR-6/8/9, 05 FR-3/4). */
export default async function GuestProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("guest:view");
  const { id } = await params;
  const guest = await getGuestProfile(user, id);
  if (!guest) notFound();

  const history = await getGuestHistory(user, id);
  const preferredCategory = history.preferredCategoryId
    ? await db.scoped(user).roomCategory.findFirst({ where: { id: history.preferredCategoryId }, select: { name: true } })
    : null;

  const tier = guestTier({ visits: history.visits, revenuePaise: history.totalRevenuePaise });

  return (
    <div className="space-y-4">
      <GuestProfile guest={guest} canRevealPii={hasPermission(user, "guest:view-pii")} tier={tier} />
      <div className="mx-auto w-full max-w-2xl px-4 pb-4">
        <GuestHistorySection history={history} preferredCategoryName={preferredCategory?.name ?? null} />
      </div>
    </div>
  );
}
