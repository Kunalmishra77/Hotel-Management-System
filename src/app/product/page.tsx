import type { Metadata } from "next";
import Link from "next/link";
import { Check, ArrowRight, Sparkles, ShieldCheck, Zap, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLANS, ADDONS } from "@/features/subscription/plans";

export const metadata: Metadata = {
  title: "Woodpecker PMS — the hotel platform for growing chains",
  description: "One platform to run every property: reservations, GST billing, housekeeping, OTA channels, direct booking, owner portal & AI. Modular pricing, per property.",
};

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/**
 * SaaS product marketing (architecture v2 · "How we offer it"). The page that
 * sells the platform to hotel operators — modular tiers, per-property pricing.
 * Public. (Guest-facing hotel booking lives at `/`.)
 */
export default function ProductPage() {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight text-primary">Woodpecker</span>
            <span className="hidden text-sm text-muted-foreground sm:inline">PMS Platform</span>
          </div>
          <nav className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex"><Link href="#plans">Pricing</Link></Button>
            <Button asChild variant="ghost" size="sm"><Link href="/sign-in">Staff sign in</Link></Button>
            <Button asChild size="sm"><a href="mailto:sales@woodpecker.example">Book a demo</a></Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-gradient-to-br from-primary to-[hsl(187,92%,17%)] text-primary-foreground">
        <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:py-24">
          <p className="mb-4 inline-block rounded-full border border-primary-foreground/25 bg-primary-foreground/10 px-3 py-1 text-xs font-medium uppercase tracking-wider">
            Property management · for chains
          </p>
          <h1 className="max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Run every hotel from one platform.
          </h1>
          <p className="mt-4 max-w-2xl text-pretty text-base text-primary-foreground/85 sm:text-lg">
            Reservations, GST-compliant billing, housekeeping, OTA channels, direct booking, owner payouts and
            AI — modular, mobile-first, and priced per property. Grow from 5 hotels to 500 without changing systems.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" variant="secondary"><a href="mailto:sales@woodpecker.example">Book a demo <ArrowRight className="ml-1.5 size-4" aria-hidden="true" /></a></Button>
            <Button asChild size="lg" variant="outline" className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10"><Link href="#plans">See pricing</Link></Button>
          </div>
        </div>
      </section>

      {/* Value props */}
      <section className="mx-auto w-full max-w-6xl px-5 py-14">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: ShieldCheck, title: "Money never drifts", desc: "GST-correct folios, gap-free invoices, night audit — auditable by construction." },
            { icon: Zap, title: "No overbooking", desc: "One availability truth across direct + OTA, enforced in the database." },
            { icon: Boxes, title: "Modular & mobile", desc: "Turn on only what you need. Runs on a phone, offline-capable for housekeeping." },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" aria-hidden="true" /></div>
              <h3 className="mt-3 text-base font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Plans */}
      <section id="plans" className="border-t bg-muted/20 scroll-mt-20">
        <div className="mx-auto w-full max-w-6xl px-5 py-14">
          <div className="mb-8 max-w-2xl">
            <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">Simple, per-property pricing</h2>
            <p className="mt-2 text-pretty text-sm text-muted-foreground sm:text-base">Pick a tier, add modules à la carte. No per-booking commission, ever.</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {PLANS.map((p, i) => (
              <div key={p.id} className={`flex flex-col rounded-2xl border p-6 shadow-sm ${i === 1 ? "border-primary ring-1 ring-primary bg-card" : "bg-card"}`}>
                {i === 1 ? <span className="mb-2 inline-block w-fit rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">Most popular</span> : null}
                <h3 className="text-lg font-semibold">{p.name}</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">{p.tagline}</p>
                <p className="mt-4"><span className="font-display text-3xl font-bold">{inr(p.pricePerPropertyMonth)}</span><span className="text-sm text-muted-foreground">/property/mo</span></p>
                <ul className="mt-5 flex-1 space-y-2 text-sm">
                  {p.includes.map((f) => (
                    <li key={f} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" /> {f}</li>
                  ))}
                </ul>
                <Button asChild className="mt-6" variant={i === 1 ? "default" : "outline"}><a href="mailto:sales@woodpecker.example">Book a demo</a></Button>
              </div>
            ))}
          </div>

          {/* Add-ons */}
          <div className="mt-10">
            <h3 className="inline-flex items-center gap-2 text-lg font-semibold"><Sparkles className="size-4 text-primary" aria-hidden="true" /> Add-on modules</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {ADDONS.map((a) => (
                <div key={a.id} className="rounded-xl border bg-card p-4 shadow-sm">
                  <p className="text-sm font-semibold">{a.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{a.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Woodpecker PMS</p>
          <p>Looking to book a stay? <Link href="/" className="font-medium text-primary hover:underline">Visit our hotels →</Link></p>
        </div>
      </footer>
    </main>
  );
}
