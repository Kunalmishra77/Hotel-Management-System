import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, MapPin, BedDouble } from "lucide-react";
import { listPublishedSites } from "@/features/booking-engine/queries";
import { requireGuest } from "@/features/guest-account/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Book a stay · Woodpecker" };

export default async function GuestBookPickerPage() {
  await requireGuest("/account/book");
  const sites = await listPublishedSites();

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <div className="mb-8">
        <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">Where to?</h1>
        <p className="mt-2 text-sm text-muted-foreground">Choose a property to check availability and book.</p>
      </div>

      {sites.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((s) => (
            <Link
              key={s.slug}
              href={`/account/book/${s.slug}`}
              className="group flex flex-col rounded-xl border bg-card p-5 shadow-sm transition hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <div className="flex items-start justify-between">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <BedDouble className="size-5" aria-hidden="true" />
                </div>
                <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
              </div>
              <h2 className="mt-3 text-base font-semibold">{s.propertyName}</h2>
              <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="size-3.5" aria-hidden="true" />
                {s.city}, {s.state}
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          Online booking is opening soon. Please call the front desk to reserve your stay.
        </div>
      )}
    </main>
  );
}
