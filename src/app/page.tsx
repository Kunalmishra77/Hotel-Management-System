import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck, Cable, ChartColumn, Receipt, Sparkles, ArrowRight } from "lucide-react";
import { getCurrentSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic"; // reads the session + a live DB value

export const metadata: Metadata = {
  title: "Woodpecker PMS — Run every property from one platform",
  description:
    "Mobile-first property management for Woodpecker Apartments & Suites: reservations, GST billing, housekeeping, channels, analytics and AI — across every property.",
};

const CAPABILITIES = [
  { icon: CalendarCheck, title: "Reservations & front desk", desc: "Booking to check-out in a few taps — no overbooking, ever." },
  { icon: Receipt, title: "GST billing & folio", desc: "Running folio, split payments, gap-free tax invoices in seconds." },
  { icon: ChartColumn, title: "Live insight", desc: "Occupancy, ARR, RevPAR & profit — per property and consolidated." },
  { icon: Cable, title: "Channels & direct booking", desc: "OTAs and your own booking website share one availability truth." },
  { icon: Sparkles, title: "Automation & AI", desc: "The right WhatsApp/email at the right moment; ask in plain language." },
];

/** Public landing/overview. Signed-in staff skip straight to the dashboard. */
export default async function Home() {
  if (await getCurrentSession()) redirect("/dashboard");

  const site = await db
    .unscoped()
    .bookingEngineConfig.findFirst({ where: { isPublished: true }, select: { slug: true } });

  return (
    <main className="min-h-dvh bg-background text-foreground">
      {/* Top bar */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight text-primary">Woodpecker PMS</span>
          <span className="hidden text-sm text-muted-foreground sm:inline">Apartments &amp; Suites</span>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/sign-in">Staff sign-in</Link>
        </Button>
      </header>

      {/* Hero */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-8 pt-10 sm:pt-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-4 inline-block rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium uppercase tracking-wider text-primary">
            One platform · every property
          </p>
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Run the whole property — from the front desk to the ledger.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-base text-muted-foreground sm:text-lg">
            Reservations, GST billing, housekeeping, POS, payroll, OTA channels, a public booking
            site, analytics and AI — built mobile-first for the people at the desk.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/sign-in">
                Staff sign-in
                <ArrowRight className="ml-1.5 size-4" aria-hidden="true" />
              </Link>
            </Button>
            {site?.slug && (
              <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                <Link href={`/book/${site.slug}`}>Book a stay</Link>
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-16">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden="true" />
              </div>
              <h2 className="mt-3 text-base font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
            </div>
          ))}
          <div className="flex flex-col justify-center rounded-xl border border-dashed bg-muted/30 p-5">
            <p className="text-sm font-medium">…and 20+ more modules</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Guest CRM, expenses, maintenance, dynamic pricing, corporate credit, accounting sync,
              and go-live data import — all in one place.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto w-full max-w-6xl px-5 py-6 text-sm text-muted-foreground">
          © Woodpecker Apartments &amp; Suites Pvt. Ltd. · Property Management System
        </div>
      </footer>
    </main>
  );
}
