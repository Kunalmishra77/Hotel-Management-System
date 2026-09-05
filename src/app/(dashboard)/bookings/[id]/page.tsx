import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CalendarDays, IndianRupee, ReceiptText, UserCheck } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/permissions";
import { getReservation, getReservationGuestPanel } from "@/features/reservations/queries";
import { ConfirmBookingButton } from "@/features/reservations/components/confirm-booking-button";
import { ReservationGuestsCard } from "@/features/reservations/components/reservation-guests-card";
import { getBalance } from "@/features/billing";
import { getReservationFolio } from "@/features/billing/queries";
import { BookingBillSummary } from "@/features/reservations/components/booking-bill-summary";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { formatDayMonth, formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Booking" };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  ENQUIRY: "secondary",
  CONFIRMED: "warning",
  IN_HOUSE: "success",
  CHECKED_OUT: "default",
  CANCELLED: "destructive",
  NO_SHOW: "destructive",
};

/** 03 T-29 — a single reservation, with a read-only live folio balance. */
export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("reservation:view");
  const { id } = await params;
  const r = await getReservation(user, id);
  if (!r) notFound();

  const canFolio = hasPermission(user, "folio:view");
  const canConfirm = r.status === "ENQUIRY" && hasPermission(user, "reservation:create");
  const canCheckIn = r.status === "CONFIRMED" && hasPermission(user, "checkin:perform");
  const canManageGuests = hasPermission(user, "reservation:modify");
  const [balancePaise, guestPanel, billFolio] = await Promise.all([
    canFolio ? getBalance(user, id) : Promise.resolve(null),
    getReservationGuestPanel(user, id),
    canFolio ? getReservationFolio(user, id) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Breadcrumb
        items={[{ label: "Home", href: "/dashboard" }, { label: "Bookings", href: "/bookings" }, { label: r.code }]}
        className="mb-3"
      />
      <PageHeader
        title={r.guestName}
        description={
          <span className="font-mono text-sm" data-testid="booking-code">
            {r.code}
          </span>
        }
        actions={
          <>
            {canConfirm ? <ConfirmBookingButton reservationId={r.id} /> : null}
            {canCheckIn ? (
              <Button asChild size="sm">
                <Link href={`/bookings/${r.id}/check-in`} data-testid="start-checkin">
                  <UserCheck /> Check in
                </Link>
              </Button>
            ) : null}
            {canFolio ? (
              <Button asChild variant={canCheckIn ? "outline" : "default"} size="sm">
                <Link href={`/bookings/${r.id}/folio`} data-testid="open-folio">
                  <ReceiptText /> Folio
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link href="/bookings">Back</Link>
            </Button>
          </>
        }
      >
        <div className="mt-2">
          <Badge variant={STATUS_VARIANT[r.status] ?? "secondary"} data-testid="booking-status">
            {r.status}
          </Badge>
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary">
              <CalendarDays /> Stay
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <p>
              <span className="text-muted-foreground">Rooms:</span>{" "}
              <span className="font-mono">{r.roomNumbers.join(", ") || "Unallocated"}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Dates:</span> {formatDayMonth(r.checkInDate)} →{" "}
              {formatDayMonth(r.checkOutDate)} · {r.nights} night(s)
            </p>
            {r.needsAttention ? <p className="text-destructive">Needs attention: {r.needsAttention}</p> : null}
          </CardContent>
        </Card>

        {canFolio ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary">
                <IndianRupee /> Folio
              </CardTitle>
            </CardHeader>
            <CardContent>
              {balancePaise === null ? (
                <p className="text-sm text-muted-foreground">No folio yet — one is created at check-in.</p>
              ) : (
                <>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Balance due</p>
                  <p
                    className={`font-display text-2xl font-bold tabular ${balancePaise > 0 ? "text-warning" : "text-success"}`}
                  >
                    {formatINR(balancePaise)}
                  </p>
                  <Button asChild variant="outline" size="sm" className="mt-3">
                    <Link href={`/bookings/${r.id}/folio`}>Open folio</Link>
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>

      {billFolio ? (
        <BookingBillSummary folio={billFolio} reservationId={r.id} canManageFolio={hasPermission(user, "folio:charge")} />
      ) : null}

      {guestPanel ? (
        <ReservationGuestsCard
          reservationId={r.id}
          status={r.status}
          adults={guestPanel.adults}
          childCount={guestPanel.children}
          guests={guestPanel.guests}
          canManage={canManageGuests}
        />
      ) : null}
    </div>
  );
}
