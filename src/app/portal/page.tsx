import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarCheck, Cable, ChartColumn, Receipt, Sparkles, ArrowRight,
  ShieldCheck, Gauge, House, BedDouble, Wallet, Wrench, type LucideIcon,
} from "lucide-react";
import { getCurrentSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic"; // reads the session

export const metadata: Metadata = {
  title: "Woodpecker PMS — Staff & owner portal",
  description:
    "The internal platform behind Woodpecker Apartments & Suites: reservations, GST billing, housekeeping, channels, analytics and AI. Sign in to your role's portal.",
};

/**
 * Staff portal launcher — the INTERNAL product's front door (one of the two
 * products that share one brain; the other is the customer website at `/`).
 * Every role signs in at the SAME secure sign-in; the portal adapts to their
 * permissions (server-side RBAC). Informational only — no credentials exposed.
 */
const PORTAL_GROUPS: { group: string; roles: { icon: LucideIcon; name: string; desc: string; role: string }[] }[] = [
  {
    group: "Management & ownership",
    roles: [
      { icon: ShieldCheck, name: "Administrator", role: "administrator", desc: "Users, roles, properties, integrations, security & audit — full control." },
      { icon: Gauge, name: "Manager", role: "manager", desc: "Occupancy, revenue, profit and full daily operations across properties." },
      { icon: House, name: "Property Owner", role: "owner", desc: "Your property's financials, document vault, schedule & payout statements." },
    ],
  },
  {
    group: "Front desk & finance",
    roles: [
      { icon: CalendarCheck, name: "Reception", role: "reception", desc: "Reservations, check-in/out, folio, guest CRM, Form C & attendance." },
      { icon: Wallet, name: "Accounts", role: "accounts", desc: "GST invoices, payments, expenses, reports & accounting sync." },
    ],
  },
  {
    group: "Operations",
    roles: [
      { icon: BedDouble, name: "Housekeeping", role: "housekeeping", desc: "Room status, linen & complaints — mobile-first, works offline." },
      { icon: Wrench, name: "Maintenance", role: "maintenance", desc: "Log & close jobs with a preventive-maintenance schedule." },
    ],
  },
];

const CAPABILITIES = [
  { icon: CalendarCheck, title: "Reservations & front desk", desc: "Booking to check-out in a few taps — no overbooking, ever." },
  { icon: Receipt, title: "GST billing & folio", desc: "Running folio, split payments, gap-free tax invoices in seconds." },
  { icon: ChartColumn, title: "Live insight", desc: "Occupancy, ARR, RevPAR & profit — per property and consolidated." },
  { icon: Cable, title: "Channels & direct booking", desc: "OTAs and your own booking website share one availability truth." },
  { icon: Sparkles, title: "Automation & AI", desc: "The right WhatsApp/email at the right moment; ask in plain language." },
];

/** Staff/owner launcher. Signed-in staff skip straight to the dashboard. */
export default async function StaffPortal() {
  if (await getCurrentSession()) redirect("/dashboard");

  return (
    <main className="min-h-dvh bg-background text-foreground">
      {/* Top bar */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight text-primary">Woodpecker PMS</span>
          <span className="hidden text-sm text-muted-foreground sm:inline">Staff &amp; owner portal</span>
        </div>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link href="/">Guest site</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
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
            <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
              <Link href="/">Visit the guest website</Link>
            </Button>
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

      {/* Role-based portals — one secure sign-in, a portal per role */}
      <section className="border-t bg-muted/20">
        <div className="mx-auto w-full max-w-6xl px-5 py-14">
          <div className="mx-auto max-w-2xl text-center">
            <p className="mb-3 inline-block rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium uppercase tracking-wider text-primary">
              One sign-in · a portal per role
            </p>
            <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              Every role gets its own portal
            </h2>
            <p className="mx-auto mt-3 text-pretty text-sm text-muted-foreground sm:text-base">
              Staff sign in once; the platform shows only what their role can do — enforced server-side,
              not just hidden. Pick a role to see what its portal covers.
            </p>
          </div>

          <div className="mt-10 space-y-8">
            {PORTAL_GROUPS.map(({ group, roles }) => (
              <div key={group}>
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{group}</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {roles.map(({ icon: Icon, name, desc, role }) => (
                    <Link
                      key={name}
                      href={`/sign-in?role=${role}`}
                      className="group rounded-xl border bg-card p-5 shadow-sm transition hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Icon className="size-5" aria-hidden="true" />
                        </div>
                        <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
                      </div>
                      <h4 className="mt-3 text-base font-semibold">{name}</h4>
                      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
                      <span className="mt-3 inline-block text-xs font-medium text-primary">Open {name} login →</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-col items-center gap-3">
            <Button asChild size="lg">
              <Link href="/sign-in">
                Staff sign-in
                <ArrowRight className="ml-1.5 size-4" aria-hidden="true" />
              </Link>
            </Button>
            <p className="text-xs text-muted-foreground">Your role decides your portal — no separate URLs to remember.</p>
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
