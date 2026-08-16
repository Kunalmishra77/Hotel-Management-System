import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MapPin, ArrowRight, Star, Wifi, ConciergeBell, UtensilsCrossed, ShieldCheck, BadgeIndianRupee, Quote } from "lucide-react";
import { getCurrentSession } from "@/lib/auth";
import { listPublishedSites } from "@/features/booking-engine/queries";
import { StayNav } from "@/features/marketing/components/stay-nav";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Woodpecker Apartments & Suites — serviced stays across India",
  description:
    "Home-like serviced apartments & suites for business and leisure. Book direct for the best rate — GST-inclusive, instant confirmation, no OTA markup.",
  robots: { index: true, follow: true },
};

const CARD_IMG = ["resort-main-building", "family-bungalow-exterior", "chalet-jungle-exterior", "resort-entrance", "pool-garden", "restaurant-pavilion"];
const STATS = [
  { n: "5", l: "Properties" }, { n: "3", l: "Cities" }, { n: "24×7", l: "Front desk" }, { n: "4.6★", l: "Guest rating" },
];
const EXPERIENCES = [
  { img: "family-room-interior-a", t: "Serviced suites", d: "Spacious apartments with a full kitchen, daily housekeeping and room to work." },
  { img: "restaurant-pavilion", t: "Dine in", d: "Fresh in-house meals and a stocked kitchen — eat when and how you like." },
  { img: "pool-trees", t: "Unwind", d: "Pools, gardens and quiet corners to switch off after a long day." },
];
const GALLERY = ["outdoor-seating", "chalet-interior-b", "lakeside-dining", "tropical-garden", "jacuzzi-chalet", "lake-sunset-tree"];
const REVIEWS = [
  { q: "Felt like a home, not a hotel room. The kitchen and space made a two-week work trip easy.", n: "Ananya R.", c: "Bengaluru" },
  { q: "Front desk actually answered at midnight. Spotless rooms, best rate booking direct.", n: "Vikram S.", c: "Mumbai" },
  { q: "Perfect for our family stay — spacious, quiet, and the staff went out of their way.", n: "Meera K.", c: "Delhi" },
];

/**
 * Woodpecker customer website — the GUEST-facing front door (Kaaya-inspired
 * eco-luxe styling, scoped via `.stay-theme`). Public + unauthenticated; a
 * signed-in STAFF session is sent to the dashboard.
 */
export default async function Home() {
  if (await getCurrentSession()) redirect("/dashboard");
  const sites = await listPublishedSites();
  const firstBook = sites[0] ? `/book/${sites[0].slug}` : "/#stays";

  return (
    <div className="stay-theme min-h-dvh">
      <StayNav bookHref="#stays" />

      {/* HERO */}
      <section className="relative flex min-h-[92dvh] items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/stays/chalet-sunset.jpg" alt="A Woodpecker serviced apartment at dusk" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(27,67,50,.55), rgba(27,67,50,.35) 40%, rgba(27,67,50,.85))" }} />
        <div className="relative mx-auto w-full max-w-7xl px-4 pt-24 sm:px-6">
          <p className="stay-label">Serviced apartments · across India</p>
          <h1 className="serif mt-4 max-w-3xl text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl" style={{ color: "var(--stone)", textShadow: "0 2px 24px rgba(0,0,0,.35)" }}>
            A home-like stay, <span className="italic" style={{ color: "var(--sand)" }}>run like a hotel.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed sm:text-lg" style={{ color: "rgba(245,240,232,.9)" }}>
            Spacious serviced apartments and suites for business and leisure. Book direct for the best rate — taxes included, confirmed in seconds.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <a href="#stays" className="stay-btn stay-btn-primary">Find your stay <ArrowRight className="size-4" /></a>
            <a href="#experiences" className="stay-btn stay-btn-ghost">What we offer</a>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section style={{ background: "var(--forest)" }}>
        <div className="mx-auto grid w-full max-w-7xl grid-cols-2 gap-6 px-4 py-12 sm:grid-cols-4 sm:px-6">
          {STATS.map((s) => (
            <div key={s.l} className="text-center">
              <p className="serif text-3xl font-bold sm:text-4xl" style={{ color: "var(--sand)" }}>{s.n}</p>
              <p className="mt-1 text-sm" style={{ color: "rgba(245,240,232,.75)" }}>{s.l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ABOUT */}
      <section id="about" className="scroll-mt-20">
        <div className="mx-auto grid w-full max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
          <div>
            <p className="stay-label">About Woodpecker</p>
            <h2 className="serif mt-3 text-3xl font-bold leading-tight sm:text-4xl" style={{ color: "var(--forest)" }}>The space of an apartment, the care of a hotel.</h2>
            <p className="mt-5 leading-relaxed" style={{ color: "var(--timber)" }}>
              Woodpecker Apartments &amp; Suites runs serviced homes across India for guests who want more than a hotel room — a proper living space, a kitchen, and room to work, backed by daily housekeeping and a front desk that answers.
            </p>
            <p className="mt-3 leading-relaxed" style={{ color: "var(--timber)" }}>
              Whether it&apos;s a two-night work trip or a two-month relocation, every stay is looked after by a real team — booked direct, with GST-inclusive prices and no OTA markup.
            </p>
            <a href="#stays" className="stay-btn stay-btn-onlight mt-7">Explore our stays</a>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/stays/garden-buddha.jpg" alt="Garden" className="row-span-2 h-full w-full rounded-sm object-cover" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/stays/lakeside-dining.jpg" alt="Dining" className="h-40 w-full rounded-sm object-cover sm:h-52" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/stays/family-bungalow-interior.jpg" alt="Suite interior" className="h-40 w-full rounded-sm object-cover sm:h-52" />
          </div>
        </div>
      </section>

      {/* STAYS (properties) */}
      <section id="stays" className="scroll-mt-20" style={{ background: "#EFE8DA" }}>
        <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <p className="stay-label">Our stays</p>
            <h2 className="serif mt-3 text-3xl font-bold sm:text-4xl" style={{ color: "var(--forest)" }}>Choose your city</h2>
            <p className="mt-3" style={{ color: "var(--timber)" }}>Live availability and best-rate direct booking at every property.</p>
          </div>
          {sites.length > 0 ? (
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {sites.map((s, i) => (
                <Link key={s.slug} href={`/book/${s.slug}`} className="group flex flex-col overflow-hidden rounded-sm bg-white shadow-sm transition duration-500 hover:-translate-y-1 hover:shadow-xl">
                  <div className="relative h-52 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/stays/${CARD_IMG[i % CARD_IMG.length]}.jpg`} alt={s.propertyName} className="size-full object-cover transition duration-700 group-hover:scale-105" />
                    <span className="absolute left-3 top-3 rounded-sm px-2 py-0.5 text-xs font-medium" style={{ background: "var(--sand)", color: "var(--forest)" }}>{s.city}</span>
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <h3 className="serif text-xl font-semibold" style={{ color: "var(--forest)" }}>{s.propertyName}</h3>
                    <p className="mt-1 inline-flex items-center gap-1.5 text-sm" style={{ color: "var(--timber)" }}>
                      <MapPin className="size-3.5" aria-hidden="true" /> {s.city}, {s.state}
                    </p>
                    <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold" style={{ color: "var(--sand)" }}>
                      View &amp; book <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" aria-hidden="true" />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-10 text-center" style={{ color: "var(--timber)" }}>Online booking is opening soon — please call the front desk to reserve.</p>
          )}
        </div>
      </section>

      {/* EXPERIENCES */}
      <section id="experiences" className="scroll-mt-20">
        <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <p className="stay-label">What we offer</p>
            <h2 className="serif mt-3 text-3xl font-bold sm:text-4xl" style={{ color: "var(--forest)" }}>Everything a longer stay needs</h2>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {EXPERIENCES.map((e) => (
              <div key={e.t} className="overflow-hidden rounded-sm bg-white shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/stays/${e.img}.jpg`} alt={e.t} className="h-52 w-full object-cover" />
                <div className="p-5">
                  <h3 className="serif text-lg font-semibold" style={{ color: "var(--forest)" }}>{e.t}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--timber)" }}>{e.d}</p>
                </div>
              </div>
            ))}
          </div>
          <ul className="mx-auto mt-8 flex max-w-3xl flex-wrap items-center justify-center gap-x-7 gap-y-3 text-sm" style={{ color: "var(--timber)" }}>
            <li className="inline-flex items-center gap-2"><Wifi className="size-4" style={{ color: "var(--olive)" }} aria-hidden="true" /> High-speed Wi-Fi</li>
            <li className="inline-flex items-center gap-2"><ConciergeBell className="size-4" style={{ color: "var(--olive)" }} aria-hidden="true" /> Daily housekeeping</li>
            <li className="inline-flex items-center gap-2"><UtensilsCrossed className="size-4" style={{ color: "var(--olive)" }} aria-hidden="true" /> In-house dining</li>
            <li className="inline-flex items-center gap-2"><ShieldCheck className="size-4" style={{ color: "var(--olive)" }} aria-hidden="true" /> 24×7 front desk</li>
            <li className="inline-flex items-center gap-2"><BadgeIndianRupee className="size-4" style={{ color: "var(--olive)" }} aria-hidden="true" /> GST-inclusive</li>
          </ul>
        </div>
      </section>

      {/* GALLERY */}
      <section id="gallery" className="scroll-mt-20" style={{ background: "#EFE8DA" }}>
        <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="mx-auto mb-8 max-w-2xl text-center">
            <p className="stay-label">Gallery</p>
            <h2 className="serif mt-3 text-3xl font-bold sm:text-4xl" style={{ color: "var(--forest)" }}>A look inside</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {GALLERY.map((g) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={g} src={`/stays/${g}.jpg`} alt="Woodpecker stay" loading="lazy" className="h-40 w-full rounded-sm object-cover sm:h-56" />
            ))}
          </div>
        </div>
      </section>

      {/* REVIEWS */}
      <section>
        <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <p className="stay-label">Guest reviews</p>
            <h2 className="serif mt-3 text-3xl font-bold sm:text-4xl" style={{ color: "var(--forest)" }}>What our guests say</h2>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {REVIEWS.map((r) => (
              <figure key={r.n} className="flex flex-col rounded-sm border p-6" style={{ borderColor: "rgba(143,175,145,.35)", background: "white" }}>
                <Quote className="size-6" style={{ color: "var(--sand)" }} aria-hidden="true" />
                <div className="mt-2 flex gap-0.5">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className="size-4 fill-current" style={{ color: "var(--sand)" }} aria-hidden="true" />)}</div>
                <blockquote className="mt-3 flex-1 text-sm leading-relaxed" style={{ color: "var(--timber)" }}>&ldquo;{r.q}&rdquo;</blockquote>
                <figcaption className="mt-4 text-sm font-semibold" style={{ color: "var(--forest)" }}>{r.n} <span className="font-normal" style={{ color: "var(--timber)" }}>· {r.c}</span></figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/stays/lake-dusk.jpg" alt="" aria-hidden="true" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0" style={{ background: "rgba(27,67,50,.8)" }} />
        <div className="relative mx-auto w-full max-w-3xl px-4 py-20 text-center sm:px-6">
          <h2 className="serif text-3xl font-bold sm:text-4xl" style={{ color: "var(--stone)" }}>Ready for your next stay?</h2>
          <p className="mx-auto mt-3 max-w-md" style={{ color: "rgba(245,240,232,.85)" }}>Book direct in seconds — best rate, taxes included, instant confirmation.</p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <a href={firstBook} className="stay-btn stay-btn-primary">Book a stay <ArrowRight className="size-4" /></a>
            <Link href="/account/sign-up" className="stay-btn stay-btn-ghost">Create account</Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer id="contact" className="scroll-mt-20" style={{ background: "var(--forest)" }}>
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-4">
          <div className="md:col-span-2">
            <span className="serif text-xl font-bold" style={{ color: "var(--stone)" }}>Woodpecker</span>
            <p className="mt-3 max-w-sm text-sm leading-relaxed" style={{ color: "rgba(245,240,232,.7)" }}>
              Serviced apartments &amp; suites across India — home-like stays, run like a hotel. Book direct for the best rate.
            </p>
          </div>
          <div>
            <p className="stay-label mb-3">Explore</p>
            <ul className="space-y-2 text-sm" style={{ color: "rgba(245,240,232,.8)" }}>
              <li><a href="#stays" className="hover:opacity-80">Our stays</a></li>
              <li><a href="#experiences" className="hover:opacity-80">What we offer</a></li>
              <li><a href="#gallery" className="hover:opacity-80">Gallery</a></li>
              <li><Link href="/account" className="hover:opacity-80">My account</Link></li>
            </ul>
          </div>
          <div>
            <p className="stay-label mb-3">Get in touch</p>
            <ul className="space-y-2 text-sm" style={{ color: "rgba(245,240,232,.8)" }}>
              <li>+91 12345 67890</li>
              <li>stay@woodpecker.example</li>
              <li>Front desk open 24×7</li>
            </ul>
          </div>
        </div>
        <div className="border-t py-5 text-center text-xs" style={{ borderColor: "rgba(245,240,232,.12)", color: "rgba(245,240,232,.6)" }}>
          © {new Date().getFullYear()} Woodpecker Apartments &amp; Suites Pvt. Ltd.
        </div>
      </footer>
    </div>
  );
}
