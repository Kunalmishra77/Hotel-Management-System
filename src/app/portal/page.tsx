import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight, CalendarCheck, Receipt, ChartColumn, Cable, Sparkles, ShieldCheck, Gauge,
  House, BedDouble, Wallet, Wrench, Store, UtensilsCrossed, Users, Building2, DoorOpen,
  Boxes, Megaphone, Globe, TrendingUp, Briefcase, Search, Database, Lock, KeyRound,
  DatabaseBackup, MapPin, Smartphone, WifiOff, RefreshCw, BadgeIndianRupee, Bot,
  MessageSquareText, BrainCircuit, LineChart, type LucideIcon,
} from "lucide-react";
import { getCurrentSession } from "@/lib/auth";
import { PortalNav } from "@/features/marketing/components/portal-nav";

export const dynamic = "force-dynamic"; // reads the session

export const metadata: Metadata = {
  title: "Woodpecker PMS — The operations platform for serviced apartments",
  description:
    "One platform to run every property: reservations, GST billing, housekeeping, maintenance, OTA channels, a direct booking site, analytics and AI — mobile-first, multi-property, India-compliant. Sign in to your role's portal.",
};

/* ── Content ─────────────────────────────────────────────────────────────── */

const STATS = [
  { n: "28", l: "integrated modules" },
  { n: "9", l: "role-based portals" },
  { n: "1", l: "secure sign-in" },
  { n: "0", l: "overbookings, by design" },
];

const CAPABILITIES: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: CalendarCheck, title: "Reservations & front desk", desc: "Booking to check-out in a few taps. A locking availability engine makes double-booking impossible — across direct and OTA." },
  { icon: Receipt, title: "GST billing & folio", desc: "A running folio per stay, split payments, and gap-free GST tax invoices generated in seconds. Money never drifts." },
  { icon: BedDouble, title: "Housekeeping & maintenance", desc: "Room status from a phone — offline-capable on weak Wi-Fi — plus job logs and preventive-maintenance reminders." },
  { icon: ChartColumn, title: "Live business insight", desc: "Occupancy, ADR, RevPAR and profit — per property and consolidated — from the folio, not estimates." },
  { icon: Cable, title: "Channels & direct booking", desc: "OTAs and your own booking website share one availability truth. Your direct site carries no OTA markup." },
  { icon: Sparkles, title: "Automation & AI", desc: "The right WhatsApp/email at the right moment, a guest chatbot, and plain-language search over your data." },
];

const PORTAL_GROUPS: { group: string; roles: { icon: LucideIcon; name: string; desc: string; role: string }[] }[] = [
  {
    group: "Leadership & ownership",
    roles: [
      { icon: ShieldCheck, name: "Super Admin", role: "administrator", desc: "Users, roles, properties, integrations, billing, security & audit — full control of the platform." },
      { icon: Gauge, name: "Manager", role: "manager", desc: "Occupancy, revenue, profit and the full daily operations centre across assigned properties." },
      { icon: House, name: "Property Owner", role: "owner", desc: "Read-mostly: financials, document vault, compliance schedule and owner payout statements." },
    ],
  },
  {
    group: "Front desk & finance",
    roles: [
      { icon: CalendarCheck, name: "Reception", role: "reception", desc: "Reservations, check-in/out, folio, guest CRM, Form C and in-house guest services." },
      { icon: Wallet, name: "Accounts", role: "accounts", desc: "GST invoices, payments, expenses, financial reports and Tally/Zoho accounting sync." },
    ],
  },
  {
    group: "Operations, outlets & stores",
    roles: [
      { icon: BedDouble, name: "Housekeeping", role: "housekeeping", desc: "Room status, linen and complaints — mobile-first and works offline, syncing when back online." },
      { icon: Wrench, name: "Maintenance", role: "maintenance", desc: "Log and close jobs, with a preventive-maintenance schedule that never lets a service slip." },
      { icon: UtensilsCrossed, name: "Outlet / POS", role: "pos_manager", desc: "Restaurant point of sale, QR self-ordering and a live kitchen ticket board — settles to the folio." },
      { icon: Store, name: "Store / Inventory", role: "inventory_manager", desc: "Six stock domains, purchase and issue, plus laundry linen reconciliation with tolerances." },
    ],
  },
];

const MODULE_GROUPS: { group: string; items: { icon: LucideIcon; name: string }[] }[] = [
  {
    group: "Front desk & guests",
    items: [
      { icon: Building2, name: "Property management" },
      { icon: DoorOpen, name: "Room inventory & status" },
      { icon: CalendarCheck, name: "Reservations" },
      { icon: Users, name: "Guest CRM" },
      { icon: House, name: "Guest history" },
    ],
  },
  {
    group: "Money & compliance",
    items: [
      { icon: Receipt, name: "Billing, folio & GST" },
      { icon: Wallet, name: "Expense management" },
      { icon: ChartColumn, name: "Profit reports" },
      { icon: BadgeIndianRupee, name: "Payroll" },
      { icon: RefreshCw, name: "Accounting sync" },
    ],
  },
  {
    group: "Operations",
    items: [
      { icon: BedDouble, name: "Housekeeping" },
      { icon: Wrench, name: "Maintenance" },
      { icon: Users, name: "Staff management" },
      { icon: UtensilsCrossed, name: "POS & kitchen" },
      { icon: Boxes, name: "Inventory & stock" },
    ],
  },
  {
    group: "Growth & channels",
    items: [
      { icon: Cable, name: "OTA channel sync" },
      { icon: Globe, name: "Direct booking engine" },
      { icon: TrendingUp, name: "Dynamic pricing" },
      { icon: Briefcase, name: "Corporate CRM" },
      { icon: Megaphone, name: "Communications" },
    ],
  },
  {
    group: "Intelligence & platform",
    items: [
      { icon: ChartColumn, name: "Dashboard & analytics" },
      { icon: Search, name: "Search & export" },
      { icon: Sparkles, name: "AI features" },
      { icon: ShieldCheck, name: "Access & security" },
      { icon: Smartphone, name: "Mobile / PWA" },
      { icon: Database, name: "Data onboarding" },
      { icon: House, name: "Owner portal" },
    ],
  },
];

const WHY: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: ShieldCheck, title: "No overbooking, ever", desc: "Availability is enforced in a locking transaction with a DB-level guarantee — not a hopeful check." },
  { icon: BadgeIndianRupee, title: "Money never drifts", desc: "Append-only folio in integer paise, GST computed per line, gap-free sequential invoices." },
  { icon: Smartphone, title: "Mobile-first", desc: "Built for a phone in the hand of reception and housekeeping — one codebase, every device." },
  { icon: RefreshCw, title: "Real-time everywhere", desc: "Live occupancy and dashboards update across devices the instant something changes." },
  { icon: Building2, title: "Multi-property", desc: "Run 10+ properties from one dashboard, each row scoped to what a user is allowed to see." },
  { icon: MapPin, title: "Built for India", desc: "GST invoicing, DPDP-ready PII handling, Aadhaar masking, Form C and an India data region." },
];

const SECURITY: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Lock, title: "Server-side RBAC", desc: "Every mutation and sensitive read is authorized server-side, property-scoped, deny-by-default." },
  { icon: KeyRound, title: "2FA & DB sessions", desc: "TOTP two-factor, DB-backed sessions with instant revoke — a changed permission takes effect at once." },
  { icon: ShieldCheck, title: "Encryption & PII masking", desc: "TLS in transit, encryption at rest, Aadhaar/passport app-encrypted and masked by default." },
  { icon: Receipt, title: "Immutable audit trail", desc: "Every business change writes an append-only audit row — who, when, before/after, request id." },
  { icon: DatabaseBackup, title: "Daily encrypted backup", desc: "Automated backups to a separate location with a documented, tested restore procedure." },
  { icon: MapPin, title: "India data residency", desc: "Database, backups and object storage hosted in an India region — DPDP-aligned by default." },
];

const AI: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Bot, title: "Guest enquiry chatbot", desc: "Answers availability and FAQs over your live data — read-only, never invents a booking." },
  { icon: Search, title: "Natural-language search", desc: "“Guests from Bangalore who stayed 2+ times” becomes a safe, permission-scoped query." },
  { icon: LineChart, title: "Revenue forecast", desc: "Time-series first, AI for the narrative — numbers come from data, not the model." },
  { icon: TrendingUp, title: "Dynamic rate suggestions", desc: "Occupancy, season and lead-time propose a rate; a human or threshold approves before it publishes." },
  { icon: MessageSquareText, title: "Sentiment & segmentation", desc: "Classify feedback and cluster guests to feed the right marketing campaign." },
  { icon: BrainCircuit, title: "Grounded by design", desc: "The model proposes; validated, authorized, audited server code executes. Never a blind write." },
];

/* ── Small building blocks ───────────────────────────────────────────────── */

function SectionHead({ eyebrow, title, sub, onDark = false }: { eyebrow: string; title: string; sub?: string; onDark?: boolean }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className={onDark ? "p-eyebrow p-eyebrow-onDark" : "p-eyebrow"}>{eyebrow}</p>
      <h2 className="serif mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl" style={{ color: onDark ? "#fff" : "var(--ink)" }}>
        {title}
      </h2>
      {sub && <p className="mx-auto mt-3 text-pretty text-base" style={{ color: onDark ? "#c3d6d6" : "var(--muted)" }}>{sub}</p>}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export default async function StaffPortal() {
  if (await getCurrentSession()) redirect("/dashboard");

  return (
    <div className="portal-page min-h-dvh">
      <PortalNav />

      {/* Hero */}
      <section
        className="relative overflow-hidden"
        style={{ background: "linear-gradient(160deg, var(--ink) 0%, var(--ink-2) 60%, #0a4750 100%)" }}
      >
        <div aria-hidden className="pointer-events-none absolute -right-32 -top-24 size-[32rem] rounded-full" style={{ background: "radial-gradient(circle, rgba(39,166,181,.22), transparent 70%)" }} />
        <div className="mx-auto w-full max-w-7xl px-4 pb-16 pt-32 sm:px-6 sm:pt-40">
          <div className="mx-auto max-w-3xl text-center">
            <p className="p-eyebrow p-eyebrow-onDark">One platform · every property</p>
            <h1 className="serif mt-4 text-balance text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl" style={{ color: "#fff" }}>
              Run every property — from the front desk to the ledger.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg" style={{ color: "#c3d6d6" }}>
              Reservations, GST billing, housekeeping, maintenance, POS, payroll, OTA channels, a direct
              booking site, analytics and AI — one mobile-first platform for the people at the desk.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/sign-in" className="p-btn p-btn-brass w-full sm:w-auto">
                Sign in to your portal <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <a href="#platform" className="p-btn p-btn-ghost w-full sm:w-auto">Explore the platform</a>
            </div>
          </div>

          {/* Stats strip */}
          <div className="mx-auto mt-16 grid max-w-4xl grid-cols-2 gap-px overflow-hidden rounded-2xl sm:grid-cols-4" style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.1)" }}>
            {STATS.map((s) => (
              <div key={s.l} className="px-5 py-6 text-center" style={{ background: "rgba(8,42,47,.55)" }}>
                <div className="serif text-4xl font-bold tabular" style={{ color: "var(--brass)" }}>{s.n}</div>
                <div className="mt-1 text-xs" style={{ color: "#b6cccc" }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* One brain, two products */}
      <section id="platform" className="scroll-mt-20" style={{ background: "var(--stone)" }}>
        <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6">
          <SectionHead
            eyebrow="One brain, two products"
            title="A guest website and a staff platform — sharing one data core."
            sub="Every booking, folio and availability truth lives once. The customer site and the internal platform read and write the same core — so nothing is ever entered twice, and the numbers always agree."
          />
          <div className="mx-auto mt-12 grid max-w-4xl items-stretch gap-4 sm:grid-cols-3">
            {[
              { icon: Globe, t: "Guest website", d: "Browse, book direct, self check-in, in-stay orders and a rewards account.", href: "/", cta: "Visit guest site" },
              { icon: Database, t: "One data core", d: "Availability, folio, guests and events — a single source of truth with an audit trail.", href: null, cta: null },
              { icon: Gauge, t: "Staff platform", d: "Front desk, finance, housekeeping, analytics and AI in a role-scoped portal.", href: "/sign-in", cta: "Staff sign-in" },
            ].map((c, i) => (
              <div key={c.t} className="relative flex flex-col rounded-2xl border p-6 text-center shadow-sm" style={{ background: i === 1 ? "var(--ink)" : "var(--paper)", borderColor: i === 1 ? "var(--ink)" : "var(--line)" }}>
                <div className="mx-auto flex size-12 items-center justify-center rounded-xl" style={{ background: i === 1 ? "rgba(39,166,181,.18)" : "rgba(14,124,139,.1)", color: i === 1 ? "var(--brass)" : "var(--teal)" }}>
                  <c.icon className="size-6" aria-hidden="true" />
                </div>
                <h3 className="serif mt-4 text-lg font-bold" style={{ color: i === 1 ? "#fff" : "var(--ink)" }}>{c.t}</h3>
                <p className="mt-2 flex-1 text-sm" style={{ color: i === 1 ? "#c3d6d6" : "var(--muted)" }}>{c.d}</p>
                {c.href && c.cta && (
                  <Link href={c.href} className="mt-4 inline-flex items-center justify-center gap-1 text-sm font-semibold" style={{ color: "var(--teal)" }}>
                    {c.cta} <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Core capabilities */}
      <section style={{ background: "var(--paper)" }}>
        <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6">
          <SectionHead eyebrow="What it does" title="Everything the property runs on, in one place." />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-2xl border p-6 shadow-sm transition hover:shadow-md" style={{ borderColor: "var(--line)", background: "var(--paper)" }}>
                <div className="flex size-11 items-center justify-center rounded-xl" style={{ background: "rgba(14,124,139,.1)", color: "var(--teal)" }}>
                  <Icon className="size-5" aria-hidden="true" />
                </div>
                <h3 className="mt-4 text-lg font-semibold" style={{ color: "var(--ink)" }}>{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Role portals */}
      <section id="roles" className="scroll-mt-20" style={{ background: "var(--stone)" }}>
        <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6">
          <SectionHead
            eyebrow="One sign-in · a portal per role"
            title="Every role gets its own portal."
            sub="Staff sign in once; the platform shows only what their role can do — enforced server-side, not merely hidden. Pick a role to open its sign-in."
          />
          <div className="mt-12 space-y-10">
            {PORTAL_GROUPS.map(({ group, roles }) => (
              <div key={group}>
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{group}</h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {roles.map(({ icon: Icon, name, desc, role }) => (
                    <Link
                      key={name}
                      href={`/sign-in?role=${role}`}
                      className="group rounded-2xl border p-6 shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2"
                      style={{ borderColor: "var(--line)", background: "var(--paper)" }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex size-11 items-center justify-center rounded-xl" style={{ background: "rgba(14,124,139,.1)", color: "var(--teal)" }}>
                          <Icon className="size-5" aria-hidden="true" />
                        </div>
                        <ArrowRight className="size-4 transition group-hover:translate-x-0.5" style={{ color: "var(--brass)" }} aria-hidden="true" />
                      </div>
                      <h4 className="mt-4 text-lg font-semibold" style={{ color: "var(--ink)" }}>{name}</h4>
                      <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>{desc}</p>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Full module suite */}
      <section id="modules" className="scroll-mt-20" style={{ background: "var(--paper)" }}>
        <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6">
          <SectionHead
            eyebrow="The complete suite"
            title="28 modules. One deployable platform."
            sub="Not a collection of add-ons — a single system with hard module boundaries, event-driven inside so automation never touches the write path."
          />
          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            {MODULE_GROUPS.map(({ group, items }) => (
              <div key={group} className="rounded-2xl border p-6" style={{ borderColor: "var(--line)", background: "var(--stone)" }}>
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--teal)" }}>{group}</h3>
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {items.map(({ icon: Icon, name }) => (
                    <li key={name} className="inline-flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium" style={{ background: "var(--paper)", color: "var(--ink-text)", border: "1px solid var(--line)" }}>
                      <Icon className="size-4 shrink-0" style={{ color: "var(--teal)" }} aria-hidden="true" /> {name}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Woodpecker */}
      <section style={{ background: "var(--stone)" }}>
        <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6">
          <SectionHead eyebrow="Why Woodpecker" title="Built to be trustworthy with money and guests." />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {WHY.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-2xl border p-6 shadow-sm" style={{ borderColor: "var(--line)", background: "var(--paper)" }}>
                <Icon className="size-6" style={{ color: "var(--brass)" }} aria-hidden="true" />
                <h3 className="mt-3 text-base font-semibold" style={{ color: "var(--ink)" }}>{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security & compliance */}
      <section id="security" className="scroll-mt-20" style={{ background: "linear-gradient(160deg, var(--ink) 0%, var(--ink-2) 100%)" }}>
        <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6">
          <SectionHead
            onDark
            eyebrow="Security & compliance"
            title="Secure by default. Compliant by design."
            sub="Auditable, encrypted and least-privilege from the ground up — the same posture whether it's a login, a refund or a PII export."
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SECURITY.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-2xl p-6" style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)" }}>
                <div className="flex size-11 items-center justify-center rounded-xl" style={{ background: "rgba(39,166,181,.16)", color: "var(--teal-bright)" }}>
                  <Icon className="size-5" aria-hidden="true" />
                </div>
                <h3 className="mt-4 text-base font-semibold" style={{ color: "#fff" }}>{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "#b6cccc" }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AI */}
      <section id="ai" className="scroll-mt-20" style={{ background: "var(--paper)" }}>
        <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6">
          <SectionHead
            eyebrow="AI, grounded"
            title="Intelligence that proposes — never a blind write."
            sub="Provider-agnostic and grounded in your data. The model drafts and explains; validated, authorized, audited server code decides and executes."
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {AI.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-2xl border p-6 shadow-sm" style={{ borderColor: "var(--line)", background: "var(--paper)" }}>
                <div className="flex size-11 items-center justify-center rounded-xl" style={{ background: "rgba(199,147,80,.14)", color: "var(--brass)" }}>
                  <Icon className="size-5" aria-hidden="true" />
                </div>
                <h3 className="mt-4 text-base font-semibold" style={{ color: "var(--ink)" }}>{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mobile / PWA */}
      <section style={{ background: "var(--stone)" }}>
        <div className="mx-auto w-full max-w-5xl px-4 py-20 sm:px-6">
          <div className="grid items-center gap-8 sm:grid-cols-2">
            <div>
              <p className="p-eyebrow">Mobile-first · installable PWA</p>
              <h2 className="serif mt-3 text-3xl font-bold tracking-tight sm:text-4xl" style={{ color: "var(--ink)" }}>
                Works on the phone in your hand.
              </h2>
              <p className="mt-3 text-base" style={{ color: "var(--muted)" }}>
                One codebase covers phone, tablet and laptop — no separate apps. The screens are designed for the
                smallest viewport first, with thumb-reachable actions.
              </p>
            </div>
            <ul className="space-y-3">
              {[
                { icon: Smartphone, t: "Installable everywhere", d: "Add to home screen on Android, iPhone, tablet or desktop." },
                { icon: WifiOff, t: "Offline housekeeping", d: "Update room status on weak Wi-Fi; it queues and syncs safely — never blind last-writer-wins." },
                { icon: RefreshCw, t: "Instant live sync", d: "Occupancy and dashboards stay current across every device in real time." },
              ].map(({ icon: Icon, t, d }) => (
                <li key={t} className="flex items-start gap-3 rounded-xl border p-4" style={{ borderColor: "var(--line)", background: "var(--paper)" }}>
                  <Icon className="mt-0.5 size-5 shrink-0" style={{ color: "var(--teal)" }} aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{t}</p>
                    <p className="text-sm" style={{ color: "var(--muted)" }}>{d}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* CTA banner */}
      <section style={{ background: "linear-gradient(160deg, var(--ink) 0%, #0a4750 100%)" }}>
        <div className="mx-auto w-full max-w-4xl px-4 py-20 text-center sm:px-6">
          <h2 className="serif text-balance text-3xl font-bold tracking-tight sm:text-4xl" style={{ color: "#fff" }}>
            One secure sign-in. Your role decides your portal.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base" style={{ color: "#c3d6d6" }}>
            No separate URLs to remember. Sign in and the platform opens the right portal for you.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/sign-in" className="p-btn p-btn-brass w-full sm:w-auto">
              Staff sign-in <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <Link href="/" className="p-btn p-btn-ghost w-full sm:w-auto">Visit the guest website</Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ background: "var(--ink)" }}>
        <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="serif text-lg font-bold" style={{ color: "#fff" }}>Woodpecker</span>
                <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--brass)" }}>PMS</span>
              </div>
              <p className="mt-3 max-w-xs text-sm" style={{ color: "#9fbaba" }}>
                The operations platform for Woodpecker Apartments &amp; Suites — reservations to the ledger, on one system.
              </p>
            </div>
            {([
              { h: "Platform", links: [["Capabilities", "#platform"], ["Role portals", "#roles"], ["Modules", "#modules"], ["AI", "#ai"]] },
              { h: "Trust", links: [["Security", "#security"], ["Compliance", "#security"], ["Mobile / PWA", "#modules"]] },
              { h: "Access", links: [["Staff sign-in", "/sign-in"], ["Guest website", "/"]] },
            ] as { h: string; links: [string, string][] }[]).map((col) => (
              <div key={col.h}>
                <h4 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#dbe9e9" }}>{col.h}</h4>
                <ul className="mt-3 space-y-2">
                  {col.links.map(([label, href]) => (
                    <li key={label}>
                      <Link href={href} className="text-sm transition-opacity hover:opacity-80" style={{ color: "#9fbaba" }}>{label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-12 border-t pt-6 text-sm" style={{ borderColor: "rgba(255,255,255,.1)", color: "#7f9a9a" }}>
            © {new Date().getFullYear()} Woodpecker Apartments &amp; Suites Pvt. Ltd. · Property Management System
          </div>
        </div>
      </footer>
    </div>
  );
}
