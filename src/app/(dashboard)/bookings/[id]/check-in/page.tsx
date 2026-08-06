import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import { getCheckInContext } from "@/features/reservations/queries";
import { isFullAadhaarStorageEnabled } from "@/lib/constants/compliance";
import { CheckInWizard } from "@/features/reservations/components/check-in-wizard";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Check in" };

/** 03 T6 — guided check-in. Only a CONFIRMED booking can start check-in. */
export default async function CheckInPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("checkin:perform");
  const { id } = await params;
  const context = await getCheckInContext(user, id);
  if (!context) notFound();
  // Already in-house / cancelled / checked-out — nothing to do here.
  if (context.status !== "CONFIRMED") redirect(`/bookings/${id}`);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Breadcrumb
        items={[
          { label: "Home", href: "/dashboard" },
          { label: "Bookings", href: "/bookings" },
          { label: context.code, href: `/bookings/${id}` },
          { label: "Check in" },
        ]}
        className="mb-3"
      />
      <PageHeader
        title={`Check in — ${context.guestName}`}
        description={<span className="font-mono text-sm">{context.code}</span>}
      />
      <CheckInWizard context={context} canStoreAadhaarScan={isFullAadhaarStorageEnabled()} />
    </div>
  );
}
