import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { getGuestForEdit } from "@/features/guests/queries";
import { EditGuestForm } from "@/features/guests/components/edit-guest-form";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Edit guest" };

/**
 * 04 FR-2 — edit guest details WHILE a stay is active (fix a mistake at or after
 * check-in). Once every stay is checked out the profile is view-only, so this page
 * is also guarded server-side (not just the UI links) — a direct URL to it for a
 * checked-out guest is refused. `guest:manage`.
 */
export default async function EditGuestPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("guest:manage");
  const { id } = await params;
  const guest = await getGuestForEdit(user, id);
  if (!guest) notFound();

  // Server-side mirror of the profile's view-only-after-checkout rule.
  const activeStay = await db.scoped(user).reservation.findFirst({
    where: { guestId: id, status: { in: ["ENQUIRY", "CONFIRMED", "IN_HOUSE"] } },
    select: { id: true },
  });
  if (!activeStay) notFound();

  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      <PageHeader title={`Edit ${guest.fullName}`} description="Correct any detail while the guest is staying (fix a mistake made at check-in)." />
      <EditGuestForm guest={guest} />
    </div>
  );
}
