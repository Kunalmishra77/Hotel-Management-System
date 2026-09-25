import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CalendarDays, IndianRupee, ReceiptText, UserCheck } from "lucide-react";
import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/permissions";
import { getReservation, getReservationGuestPanel } from "@/features/reservations/queries";
import { getGuestProfile } from "@/features/guests/queries";
import { pendingGuestInfo } from "@/features/reservations/domain/guest-checklist";
import { ClipboardCheck } from "lucide-react";
import { ConfirmBookingButton } from "@/features/reservations/components/confirm-booking-button";
import { ReservationGuestsCard } from "@/features/reservations/components/reservation-guests-card";
import { ExtendStayCard } from "@/features/reservations/components/extend-stay-card";
import { CancelBookingButton } from "@/features/reservations/components/cancel-booking-button";
import { CheckOutButton } from "@/features/reservations/components/check-out-button";
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
  const canCheckOut = r.status === "IN_HOUSE" && hasPermission(user, "checkout:perform");
  const canManageGuests = hasPermission(user, "reservation:modify");
  // Cancellation is a PRE-ARRIVAL action only (domain: IN_HOUSE → only CHECKED_OUT).
  // An in-house guest is checked out / recorded as early departure — never cancelled.
  const canCancel = hasPermission(user, "reservation:cancel") && ["ENQUIRY", "CONFIRMED"].includes(r.status);
  const [balancePaise, guestPanel, billFolio, guestProfile] = await Promise.all([
    canFolio ? getBalance(user, id) : Promise.resolve(null),
    getReservationGuestPanel(user, id),
    canFolio ? getReservationFolio(user, id) : Promise.resolve(null),
    getGuestProfile(user, r.guestId),
  ]);

  // Pending guest info/documents (client req #6) — surfaced before checkout so
  // reception collects what's missing. Only shown while the stay is still open.
  const showChecklist = ["ENQUIRY", "CONFIRMED", "IN_HOUSE"].includes(r.status);
  const pending = showChecklist && guestProfile
    ? pendingGuestInfo({
        maskedMobile: guestProfile.maskedMobile,
        maskedEmail: guestProfile.maskedEmail,
        companyName: guestProfile.companyName,
        gstNumber: guestProfile.gstNumber,
        addressLine: guestProfile.addressLine,
        ids: guestProfile.ids,
        balancePaise,
      })
    : [];

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
            {canCheckOut ? <CheckOutButton reservationId={r.id} /> : null}
            {canFolio ? (
              <Button asChild variant={canCheckIn ? "outline" : "default"} size="sm">
                <Link href={`/bookings/${r.id}/folio`} data-testid="open-folio">
                  <ReceiptText /> Folio
                </Link>
              </Button>
            ) : null}
            {/* Client req #4 — guest details stay editable AFTER check-in, so a
                mistake made while filling can be corrected any time. */}
            {hasPermission(user, "guest:manage") ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/guests/${r.guestId}/edit`} data-testid="edit-guest-details">Edit guest details</Link>
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

      {pending.length > 0 ? (
        <Card className="mt-4 border-warning/40 bg-warning/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-warning">
              <ClipboardCheck /> Pending information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-sm text-muted-foreground">
              Collect these from the guest{r.status === "IN_HOUSE" ? " before checkout" : " at check-in"}:
            </p>
            <ul className="space-y-1.5 text-sm">
              {pending.map((item) => (
                <li key={item.key} className="flex items-center gap-2">
                  <span aria-hidden="true" className={item.required ? "text-warning" : "text-muted-foreground"}>●</span>
                  <span>{item.label}</span>
                  {item.required ? <Badge variant="warning" className="ml-1">Required</Badge> : <span className="text-xs text-muted-foreground">optional</span>}
                </li>
              ))}
            </ul>
            {canManageGuests ? (
              <Button asChild variant="outline" size="sm" className="mt-3">
                <Link href={`/guests/${r.guestId}`}>Update guest details</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {(r.status === "IN_HOUSE" || r.status === "CONFIRMED") && canManageGuests ? (
        <ExtendStayCard reservationId={r.id} checkOutDate={r.checkOutDate.toISOString().slice(0, 10)} />
      ) : null}

      {canCancel ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <span className="text-sm text-muted-foreground">Cancel this booking (guest cancelled by phone/online).</span>
          <CancelBookingButton reservationId={r.id} />
        </div>
      ) : null}

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
          notes={guestPanel.notes}
          expectedArrival={guestPanel.expectedArrival}
          canManage={canManageGuests}
        />
      ) : null}
    </div>
  );
}
