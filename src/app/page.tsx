import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight, MapPin, ShieldCheck, BadgeIndianRupee, Zap, Sparkles,
  BedDouble, Wifi, ConciergeBell, CalendarCheck, type LucideIcon,
} from "lucide-react";
import { getCurrentSession } from "@/lib/auth";
import { listPublishedSites } from "@/features/booking-engine/queries";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic"; // reads the session + live published sites

export const metadata: Metadata = {
  title: "Woodpecker Apartments & Suites — Book serviced apartments across India",
  description:
    "Serviced apartments & suites for business and leisure stays. Book direct for the best rate — GST-inclusive prices, instant confirmation, no OTA markup.",
};

const REASONS: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: BadgeIndianRupee, title: "Best rate, book direct", desc: "The lowest price is always here — no OTA commission added on top." },
  { icon: ShieldCheck, title: "GST-inclusive, no surprises", desc: "The price you see includes taxes. A proper GST invoice every time." },
  { icon: Zap, title: "Instant confirmation", desc: "Real-time availability across every property — confirmed in seconds." },
  { icon: ConciergeBell, title: "Serviced comfort", desc: "Housekeeping, Wi-Fi and a front desk that actually answers." },
];

const AMENITIES: { icon: LucideIcon; label: string }[] = [
  { icon: BedDouble, label: "Fully-serviced suites" },
  { icon: Wifi, label: "High-speed Wi-Fi" },
  { icon: ConciergeBell, label: "24×7 front desk" },
  { icon: CalendarCheck, label: "Flexible stays" },
];

/**
 * Customer website — the GUEST-facing front door (one of the two products that
 * share one brain; the other is the staff portal at `/staff`). Public and
 * unauthenticated. A signed-in STAFF session is sent to the dashboard; guests
 * have no account yet (guest login & "My bookings" arrive in Phase 2).
 */
export default async function Home() {
  if (await getCurrentSession()) redirect("/dashboard");

  const sites = await listPublishedSites();

  return (
    <main className="min-h-dvh bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight text-primary">Woodpecker</span>
            <span className="hidden text-sm text-muted-foreground sm:inline">Apartments &amp; Suites</span>
          </div>
          <nav className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="#properties">Our properties</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="#why">Why book direct</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/account">Sign in</Link>
            </Button>
            {sites[0] && (
              <Button asChild size="sm">
                <Link href={`/book/${sites[0].slug}`}>Book a stay</Link>
              </Button>
            )}
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary to-[hsl(187,92%,17%)] text-primary-foreground">
        <div className="mx-auto w-full max-w-6xl px-5 pb-16 pt-16 sm:pb-20 sm:pt-24">
          <div className="max-w-2xl">
            <p className="mb-4 inline-block rounded-full border border-primary-foreground/25 bg-primary-foreground/10 px-3 py-1 text-xs font-medium uppercase tracking-wider">
              Serviced apartments · across India
            </p>
            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
              A home-like stay, run like a hotel.
            </h1>
            <p className="mt-4 max-w-xl text-pretty text-base text-primary-foreground/85 sm:text-lg">
              Spacious serviced apartments and suites for business and leisure. Book direct for the
              best rate — taxes included, confirmed instantly.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              {sites[0] ? (
                <Button asChild size="lg" variant="secondary" className="w-full sm:w-auto">
                  <Link href="#properties">
                    Find your stay
                    <ArrowRight className="ml-1.5 size-4" aria-hidden="true" />
                  </Link>
                </Button>
              ) : (
                <Button asChild size="lg" variant="secondary" className="w-full sm:w-auto">
                  <Link href="#why">See what we offer</Link>
                </Button>
              )}
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-primary-foreground/85">
              {AMENITIES.map(({ icon: Icon, label }) => (
                <li key={label} className="inline-flex items-center gap-1.5">
                  <Icon className="size-4" aria-hidden="true" /> {label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Our properties */}
      <section id="properties" className="mx-auto w-full max-w-6xl scroll-mt-20 px-5 py-14">
        <div className="mb-8 max-w-2xl">
          <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">Our properties</h2>
          <p className="mt-2 text-pretty text-sm text-muted-foreground sm:text-base">
            Pick a location to check live availability and book direct.
          </p>
        </div>

        {sites.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sites.map((s) => (
              <Link
                key={s.slug}
                href={`/book/${s.slug}`}
                className="group flex flex-col rounded-xl border bg-card p-5 shadow-sm transition hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div className="flex items-start justify-between">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <BedDouble className="size-5" aria-hidden="true" />
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
                </div>
                <h3 className="mt-3 text-base font-semibold">{s.propertyName}</h3>
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="size-3.5" aria-hidden="true" />
                  {s.city}, {s.state}
                </p>
                <span className="mt-4 inline-block text-xs font-medium text-primary">Check availability &amp; book →</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed bg-muted/30 p-8 text-center">
            <p className="text-sm font-medium">Online booking is opening soon.</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Our properties are getting their booking pages ready. In the meantime, please call the
              front desk to reserve your stay.
            </p>
          </div>
        )}
      </section>

      {/* Why book direct */}
      <section id="why" className="border-t bg-muted/20 scroll-mt-20">
        <div className="mx-auto w-full max-w-6xl px-5 py-14">
          <div className="mb-8 max-w-2xl">
            <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">Why book direct</h2>
            <p className="mt-2 text-pretty text-sm text-muted-foreground sm:text-base">
              Booking on our own site is always the best deal — and the simplest.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {REASONS.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-xl border bg-card p-5 shadow-sm">
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" aria-hidden="true" />
                </div>
                <h3 className="mt-3 text-base font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Guest account teaser — arriving in the next phase (no dead button) */}
      <section className="mx-auto w-full max-w-6xl px-5 py-14">
        <div className="flex flex-col items-start gap-4 rounded-2xl border bg-card p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div className="max-w-xl">
            <p className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-primary">
              <Sparkles className="size-3.5" aria-hidden="true" /> Your account
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight">Sign in for a faster stay</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Create an account to see <b>My Bookings</b>, save your details for one-tap booking, and manage
              your stay from your phone. Use your email, or just your phone number — no password needed.
            </p>
          </div>
          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
            <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
              <Link href="/account/sign-up">Create account</Link>
            </Button>
            {sites[0] && (
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link href={`/book/${sites[0].slug}`}>
                  Book a stay
                  <ArrowRight className="ml-1.5 size-4" aria-hidden="true" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© Woodpecker Apartments &amp; Suites Pvt. Ltd.</span>
          <Link
            href="/portal"
            className="inline-flex items-center gap-1.5 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Staff &amp; owner login <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      </footer>
    </main>
  );
}
