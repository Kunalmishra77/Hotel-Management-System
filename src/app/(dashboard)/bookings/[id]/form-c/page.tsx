import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import { getCheckInContext } from "@/features/reservations/queries";
import { FormCStandalone } from "@/features/reservations/components/form-c-standalone";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Form C" };

/**
 * Fill / re-generate a booking's Form C outside the check-in wizard (client,
 * 15 Nov 2026): for foreign guests whose Form C was missed at check-in —
 * in-house, or already checked out (FRRO still needs it).
 */
export default async function BookingFormCPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("checkin:perform");
  const context = await getCheckInContext(user, id);
  if (!context || !["CONFIRMED", "IN_HOUSE", "CHECKED_OUT"].includes(context.status)) notFound();
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <PageHeader title={`Form C — ${context.guestName}`} description={<span className="font-mono text-sm">{context.code}</span>} />
      <div className="rounded-xl border bg-card p-4 sm:p-6">
        <FormCStandalone context={context} />
      </div>
    </div>
  );
}
