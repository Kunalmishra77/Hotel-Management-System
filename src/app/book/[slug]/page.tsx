/**
 * Public booking site — 23 T-18/T-19. UNAUTHENTICATED, outside (dashboard). The
 * page only resolves the property's public name from a PUBLISHED slug; all
 * availability/pricing/booking happens client-side against the public API.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldCheck, BadgeIndianRupee, Zap } from "lucide-react";
import { loadPublishedConfig } from "@/features/booking-engine/queries";
import { BookingWidget } from "@/features/booking-engine/components/booking-widget";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const cfg = await loadPublishedConfig(slug);
  return { title: cfg ? `Book · ${cfg.propertyName}` : "Booking" };
}

export default async function BookingSitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const cfg = await loadPublishedConfig(slug);
  if (!cfg) notFound();

  return (
    <div className="min-h-dvh bg-background">
      {/* Public header */}
      <header className="mx-auto flex w-full max-w-4xl items-center justify-between px-5 py-4">
        <span className="text-base font-semibold tracking-tight text-primary">Woodpecker</span>
        <span className="text-sm text-muted-foreground">{cfg.propertyName}</span>
      </header>

      {/* Hero band */}
      <section className="bg-gradient-to-br from-primary to-[hsl(187,92%,17%)] text-primary-foreground">
        <div className="mx-auto max-w-4xl px-5 pb-28 pt-14 text-center sm:pt-20">
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Book your stay at {cfg.propertyName}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-pretty text-sm text-primary-foreground/85 sm:text-base">
            Serviced apartments &amp; suites — book direct for the best rate, taxes included.
          </p>
        </div>
      </section>

      {/* Search widget, overlapping the hero */}
      <div className="mx-auto -mt-20 w-full max-w-md px-4">
        <div className="rounded-lg shadow-xl">
          <BookingWidget slug={cfg.slug} propertyName={cfg.propertyName} />
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-primary" /> Secure booking</span>
          <span className="inline-flex items-center gap-1.5"><BadgeIndianRupee className="size-3.5 text-primary" /> GST-inclusive prices</span>
          <span className="inline-flex items-center gap-1.5"><Zap className="size-3.5 text-primary" /> Instant confirmation</span>
        </div>
      </div>

      <footer className="mx-auto mt-16 w-full max-w-4xl border-t px-5 py-6 text-center text-xs text-muted-foreground">
        © Woodpecker Apartments &amp; Suites Pvt. Ltd. · {cfg.propertyName}
      </footer>
    </div>
  );
}
