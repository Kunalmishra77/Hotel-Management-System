import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarCheck, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listPublishedSites } from "@/features/booking-engine/queries";
import { requireGuest, getGuestSummary } from "@/features/guest-account/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My account · Woodpecker" };

export default async function AccountHomePage() {
  const principal = await requireGuest("/account");
  const [summary, sites] = await Promise.all([getGuestSummary(principal), listPublishedSites()]);
  const bookHref = sites.length > 0 ? "/account/book" : "/";

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <div className="mb-8">
        <p className="text-sm text-muted-foreground">Welcome back</p>
        <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{summary.fullName}</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Contact on file */}
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Contact on file</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="inline-flex items-center gap-2">
              <Phone className="size-4 text-muted-foreground" aria-hidden="true" />
              {summary.mobileMasked ?? "—"}
            </li>
            <li className="inline-flex items-center gap-2">
              <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
              {summary.emailMasked ?? "Not added yet"}
            </li>
          </ul>
        </section>

        {/* Book a stay */}
        <section className="flex flex-col justify-between rounded-xl border bg-card p-5 shadow-sm">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Plan a stay</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Check live availability across our properties and book direct — your details are already saved.
            </p>
          </div>
          <Button asChild size="lg" className="mt-4 w-full sm:w-auto">
            <Link href={bookHref}>
              Book a stay
              <ArrowRight className="ml-1.5 size-4" aria-hidden="true" />
            </Link>
          </Button>
        </section>
      </div>

      {/* My bookings */}
      <section className="mt-4 rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="inline-flex items-center gap-2 text-base font-semibold">
            <CalendarCheck className="size-5 text-primary" aria-hidden="true" />
            My bookings
          </h2>
          <Button asChild size="sm" variant="outline">
            <Link href="/account/bookings">
              View all
              <ArrowRight className="ml-1.5 size-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          See your upcoming and past stays, view the bill, and cancel within the free window.
        </p>
      </section>
    </main>
  );
}
