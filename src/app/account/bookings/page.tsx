import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarCheck, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireGuest, listMyBookings, type MyBooking } from "@/features/guest-account/queries";
import { BookingStatusBadge } from "@/features/guest-account/components/booking-status-badge";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My bookings · Woodpecker" };

const rupees = (paise: number): string =>
  `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const day = (d: Date): string => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function BookingCard({ b }: { b: MyBooking }) {
  return (
    <Link
      href={`/account/bookings/${b.reservationId}`}
      className="group flex items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">{b.propertyName}</span>
          <BookingStatusBadge status={b.status} />
        </div>
        <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <CalendarCheck className="size-3.5" aria-hidden="true" />
          {day(b.checkInDate)} → {day(b.checkOutDate)} · {b.nights}n
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {b.code} · {rupees(b.totalPaise)} incl. GST
        </p>
      </div>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
    </Link>
  );
}

export default async function MyBookingsPage() {
  const principal = await requireGuest("/account/bookings");
  const bookings = await listMyBookings(principal);
  const upcoming = bookings.filter((b) => b.upcoming);
  const past = bookings.filter((b) => !b.upcoming);

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10">
      <div className="mb-8 flex items-center justify-between gap-3">
        <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">My bookings</h1>
        <Button asChild size="sm">
          <Link href="/account/book">Book a stay</Link>
        </Button>
      </div>

      {bookings.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/30 p-8 text-center">
          <p className="text-sm font-medium">No bookings yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            When you book a stay it&apos;ll show up here with your bill and the option to cancel or modify.
          </p>
          <Button asChild className="mt-4">
            <Link href="/account/book">
              Book your first stay
              <ArrowRight className="ml-1.5 size-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          {upcoming.length > 0 && (
            <section>
              <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <MapPin className="size-4" aria-hidden="true" /> Upcoming
              </h2>
              <div className="space-y-3">
                {upcoming.map((b) => (
                  <BookingCard key={b.reservationId} b={b} />
                ))}
              </div>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Past &amp; cancelled</h2>
              <div className="space-y-3">
                {past.map((b) => (
                  <BookingCard key={b.reservationId} b={b} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
