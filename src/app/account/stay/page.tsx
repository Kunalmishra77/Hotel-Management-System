import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BedDouble, CalendarClock, ReceiptIndianRupee, UtensilsCrossed, ConciergeBell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireGuest } from "@/features/guest-account/queries";
import { getActiveStay, listMyRequests } from "@/features/guest-account/stay-queries";
import { GuestRequestForm } from "@/features/guest-account/components/guest-request-form";
import { KIND_LABEL, REQUEST_STATUS_LABEL, ACTIVE_REQUEST_STATUSES, isGuestRequestKind } from "@/features/guest-account/domain/request-kind";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My stay · Woodpecker" };

const rupees = (paise: number): string =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const day = (d: Date): string => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

function StatusBadge({ status }: { status: string }) {
  const active = (ACTIVE_REQUEST_STATUSES as readonly string[]).includes(status);
  const declined = status === "DECLINED";
  const cls = declined
    ? "bg-destructive/10 text-destructive"
    : active
      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
      : "bg-success/10 text-success";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {REQUEST_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export default async function MyStayPage() {
  const principal = await requireGuest("/account/stay");
  const [stay, requests] = await Promise.all([getActiveStay(principal), listMyRequests(principal)]);

  if (!stay) {
    return (
      <main className="mx-auto w-full max-w-2xl px-5 py-12">
        <div className="rounded-xl border border-dashed bg-muted/30 p-8 text-center">
          <ConciergeBell className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">You&apos;re not checked in right now</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            In-room services — food, housekeeping, and more — appear here once you&apos;ve checked in.
          </p>
          <Button asChild className="mt-4">
            <Link href="/account/bookings">View my bookings</Link>
          </Button>
        </div>
      </main>
    );
  }

  const duePaise = stay.folio?.balancePaise ?? 0;

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-8">
      {/* Stay header */}
      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wider text-primary">Currently staying</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{stay.propertyName}</h1>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              <BedDouble className="size-3.5" aria-hidden="true" /> Room
            </dt>
            <dd className="mt-1 text-base font-semibold">{stay.roomNumber ?? "—"}</dd>
          </div>
          <div>
            <dt className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              <CalendarClock className="size-3.5" aria-hidden="true" /> Check-out
            </dt>
            <dd className="mt-1 text-base font-semibold">{day(stay.checkOutDate)}</dd>
          </div>
        </dl>
      </div>

      {/* Quick actions */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {stay.orderToken && (
          <Link
            href={`/order/${stay.orderToken}`}
            className="group flex items-center justify-between rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md"
          >
            <span className="inline-flex items-center gap-2 font-medium">
              <UtensilsCrossed className="size-5 text-primary" aria-hidden="true" /> Order food
            </span>
            <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
          </Link>
        )}
        <div className="flex items-center justify-between rounded-xl border bg-card p-4 shadow-sm">
          <span className="inline-flex items-center gap-2 font-medium">
            <ReceiptIndianRupee className="size-5 text-primary" aria-hidden="true" /> Balance
          </span>
          <span className="font-semibold">{rupees(duePaise)}</span>
        </div>
      </div>

      {/* Folio */}
      {stay.folio && stay.folio.lines.length > 0 && (
        <section className="mt-4 rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Your bill</h2>
          <ul className="mt-3 divide-y text-sm">
            {stay.folio.lines.map((l, i) => (
              <li key={i} className="flex items-center justify-between py-2">
                <span className="min-w-0 truncate pr-3 text-muted-foreground">{l.description}</span>
                <span className="tabular-nums">{rupees(l.amountPaise)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between border-t pt-3 font-semibold">
            <span>Balance due at checkout</span>
            <span className="tabular-nums">{rupees(duePaise)}</span>
          </div>
        </section>
      )}

      {/* Request service */}
      <section className="mt-4 rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="inline-flex items-center gap-2 text-base font-semibold">
          <ConciergeBell className="size-5 text-primary" aria-hidden="true" /> Request something
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Housekeeping, a repair, extra amenities — we&apos;ll get on it.</p>
        <div className="mt-4">
          <GuestRequestForm />
        </div>
      </section>

      {/* Tracker */}
      {requests.length > 0 && (
        <section className="mt-4 rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Your requests</h2>
          <ul className="mt-3 space-y-3">
            {requests.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{isGuestRequestKind(r.kind) ? KIND_LABEL[r.kind] : r.kind}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.detail}</p>
                </div>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
