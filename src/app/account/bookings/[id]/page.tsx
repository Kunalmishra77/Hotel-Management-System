import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarCheck, MapPin, ReceiptIndianRupee } from "lucide-react";
import { requireGuest, getMyBooking } from "@/features/guest-account/queries";
import { BookingStatusBadge } from "@/features/guest-account/components/booking-status-badge";
import { CancelBookingButton } from "@/features/guest-account/components/cancel-booking-button";
import { OnlineCheckIn } from "@/features/guest-account/components/online-checkin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Booking · Woodpecker" };

const rupees = (paise: number): string =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const day = (d: Date): string =>
  d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const principal = await requireGuest(`/account/bookings/${id}`);
  const b = await getMyBooking(principal, id);
  if (!b) notFound();

  const duePaise = Math.max(0, b.totalPaise - b.advancePaise);

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-8">
      <Link
        href="/account/bookings"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" /> My bookings
      </Link>

      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="inline-flex items-center gap-2 text-xl font-semibold tracking-tight">
              <MapPin className="size-5 text-primary" aria-hidden="true" />
              {b.propertyName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Booking {b.code}</p>
          </div>
          <BookingStatusBadge status={b.status} />
        </div>

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Stay</dt>
            <dd className="mt-1 inline-flex items-center gap-1.5 text-sm">
              <CalendarCheck className="size-4 text-muted-foreground" aria-hidden="true" />
              {day(b.checkInDate)} → {day(b.checkOutDate)}
            </dd>
            <dd className="mt-0.5 text-xs text-muted-foreground">{b.nights} night(s)</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payment</dt>
            <dd className="mt-1 inline-flex items-center gap-1.5 text-sm">
              <ReceiptIndianRupee className="size-4 text-muted-foreground" aria-hidden="true" />
              {rupees(b.totalPaise)} incl. GST
            </dd>
            <dd className="mt-0.5 text-xs text-muted-foreground">
              Paid {rupees(b.advancePaise)} · {duePaise > 0 ? `${rupees(duePaise)} due at hotel` : "fully paid"}
            </dd>
          </div>
        </dl>

        {(b.onlineCheckInEligible || b.onlineCheckInAt) && (
          <div className="mt-6 border-t pt-5">
            <OnlineCheckIn reservationId={b.reservationId} alreadyCheckedIn={b.onlineCheckInAt !== null} />
          </div>
        )}

        <div className="mt-6 border-t pt-5">
          {b.cancellable ? (
            <CancelBookingButton reservationId={b.reservationId} />
          ) : b.upcoming ? (
            <p className="text-sm text-muted-foreground">
              This booking can no longer be cancelled online. To change or cancel it, please call the front desk.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Need to book again?{" "}
              <Link href="/account/book" className="font-medium text-primary underline-offset-4 hover:underline">
                Plan a new stay
              </Link>
              .
            </p>
          )}
        </div>
      </div>

      {b.upcoming && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Want different dates? Cancel within the free window and rebook, or call the desk for help.
        </p>
      )}
    </main>
  );
}
