import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { getGuestProfile } from "@/features/guests/queries";
import { GuestProfile } from "@/features/guests/components/guest-profile";
import { getGuestHistory, guestStays } from "@/features/guest-history/queries";
import { guestTier } from "@/features/guest-history/domain/tier";
import { GuestHistorySection } from "@/features/guest-history/components/guest-history-section";
import { GuestStaysCard } from "@/features/guest-history/components/guest-stays-card";

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

  // A guest record is edited / has IDs uploaded only while a stay is ACTIVE
  // (enquiry, confirmed, or in-house). Once every stay is checked out, the profile
  // is view-only — after checkout you view IDs, you don't add/replace them. A repeat
  // guest with an upcoming booking is editable again.
  const activeStay = await db.scoped(user).reservation.findFirst({
    where: { guestId: id, status: { in: ["ENQUIRY", "CONFIRMED", "IN_HOUSE"] } },
    select: { id: true },
  });
  const canManage = hasPermission(user, "guest:manage") && activeStay !== null;

  const [history, stays] = await Promise.all([getGuestHistory(user, id), guestStays(user, id)]);
  const preferredCategory = history.preferredCategoryId
    ? await db.scoped(user).roomCategory.findFirst({ where: { id: history.preferredCategoryId }, select: { name: true } })
    : null;

  const tier = guestTier({ visits: history.visits, revenuePaise: history.totalRevenuePaise });

  return (
    <div className="space-y-4">
      <GuestProfile
        guest={guest}
        canRevealPii={hasPermission(user, "guest:view-pii")}
        canManage={canManage}
        tier={tier}
      />
      <div className="mx-auto w-full max-w-2xl px-4">
        <GuestStaysCard stays={stays} />
      </div>
      <div className="mx-auto w-full max-w-2xl px-4 pb-4">
        <GuestHistorySection history={history} preferredCategoryName={preferredCategory?.name ?? null} />
      </div>
    </div>
  );
}
