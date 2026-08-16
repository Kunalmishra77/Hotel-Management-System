/**
 * Public property page — the OTA-style hotel page (photos · overview · amenities ·
 * room types · location · policies) with a booking card, in the customer-site
 * eco-luxe styling (`.stay-theme`). UNAUTHENTICATED, outside (dashboard). Content
 * is date-independent (loadPropertyShowcase); booking happens in BookingWidget.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  MapPin, Star, ShieldCheck, BadgeIndianRupee, Zap, Clock, CalendarX, ArrowRight, Check,
} from "lucide-react";
import { loadPropertyShowcase, type ShowcaseRoomType } from "@/features/booking-engine/queries";
import { BookingWidget } from "@/features/booking-engine/components/booking-widget";
import { PropertyGallery } from "@/features/booking-engine/components/property-gallery";
import { amenityIcon } from "@/features/booking-engine/components/amenity-icon";
import { StayNav } from "@/features/marketing/components/stay-nav";

export const dynamic = "force-dynamic";

const rupees = (paise: number): string => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const s = await loadPropertyShowcase(slug);
  return {
    title: s ? `${s.propertyName}, ${s.city} — Book direct · Woodpecker` : "Booking",
    description: s ? `Book ${s.propertyName} in ${s.city} direct — GST-inclusive rates, instant confirmation, no OTA markup.` : undefined,
    robots: { index: true, follow: true },
  };
}

export default async function PropertyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await loadPropertyShowcase(slug);
  if (!s) notFound();

  return (
    <div className="stay-theme min-h-dvh">
      <StayNav bookHref="#book" />

      <main className="mx-auto w-full max-w-6xl px-4 pt-24 sm:px-6">
        {/* Breadcrumb + title */}
        <Link href="/#stays" className="inline-flex items-center gap-1.5 text-sm hover:opacity-80" style={{ color: "var(--olive)" }}>
          <ArrowRight className="size-3.5 rotate-180" aria-hidden="true" /> All stays
        </Link>
        <div className="mt-3 mb-4">
          <h1 className="serif text-3xl font-bold leading-tight sm:text-4xl" style={{ color: "var(--forest)" }}>{s.propertyName}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" style={{ color: "var(--timber)" }}>
            <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden="true" /> {s.addressLine1}, {s.city}, {s.state}</span>
            <span className="inline-flex items-center gap-1 rounded-sm px-2 py-0.5 font-medium" style={{ background: "var(--sand)", color: "var(--forest)" }}>
              <Star className="size-3.5 fill-current" aria-hidden="true" /> 4.6 · Serviced apartments
            </span>
          </div>
        </div>

        <PropertyGallery images={s.heroImages} alt={s.propertyName} />

        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_360px]">
          <div className="min-w-0 space-y-10">
            {/* Overview */}
            <section>
              <h2 className="serif text-2xl font-semibold tracking-tight" style={{ color: "var(--forest)" }}>A home-like stay, run like a hotel</h2>
              <p className="mt-3 leading-relaxed" style={{ color: "var(--timber)" }}>
                Spacious serviced apartments in {s.city} for business and leisure — daily housekeeping, a 24×7 front desk,
                and a full kitchen. Book direct for the best rate: prices are GST-inclusive and confirmed instantly.
              </p>
              <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm" style={{ color: "var(--timber)" }}>
                <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-4" style={{ color: "var(--olive)" }} aria-hidden="true" /> Secure booking</span>
                <span className="inline-flex items-center gap-1.5"><BadgeIndianRupee className="size-4" style={{ color: "var(--olive)" }} aria-hidden="true" /> GST-inclusive</span>
                <span className="inline-flex items-center gap-1.5"><Zap className="size-4" style={{ color: "var(--olive)" }} aria-hidden="true" /> Instant confirmation</span>
              </div>
            </section>

            {/* Amenities */}
            {s.amenities.length > 0 && (
              <section>
                <h2 className="serif text-2xl font-semibold tracking-tight" style={{ color: "var(--forest)" }}>What this place offers</h2>
                <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {s.amenities.map((a) => {
                    const Icon = amenityIcon(a);
                    return (
                      <li key={a} className="inline-flex items-center gap-2 text-sm" style={{ color: "var(--timber)" }}>
                        <Icon className="size-4 shrink-0" style={{ color: "var(--olive)" }} aria-hidden="true" /> {a}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {/* Room types */}
            <section id="rooms">
              <h2 className="serif text-2xl font-semibold tracking-tight" style={{ color: "var(--forest)" }}>Choose your room</h2>
              <div className="mt-4 space-y-4">
                {s.roomTypes.map((r) => <RoomTypeCard key={r.id} room={r} />)}
              </div>
            </section>

            {/* Location */}
            <section>
              <h2 className="serif text-2xl font-semibold tracking-tight" style={{ color: "var(--forest)" }}>Where you&apos;ll be</h2>
              <p className="mt-2 inline-flex items-center gap-1.5 text-sm" style={{ color: "var(--timber)" }}>
                <MapPin className="size-4" style={{ color: "var(--olive)" }} aria-hidden="true" /> {s.addressLine1}, {s.city}, {s.state}
              </p>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.propertyName}, ${s.addressLine1}, ${s.city}`)}`}
                target="_blank" rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-sm font-medium hover:underline" style={{ color: "var(--sand)" }}
              >
                Open in Google Maps <ArrowRight className="size-3.5" aria-hidden="true" />
              </a>
            </section>

            {/* Policies */}
            <section>
              <h2 className="serif text-2xl font-semibold tracking-tight" style={{ color: "var(--forest)" }}>Good to know</h2>
              <ul className="mt-3 space-y-2 text-sm" style={{ color: "var(--timber)" }}>
                <li className="inline-flex items-center gap-2"><Clock className="size-4 shrink-0" style={{ color: "var(--olive)" }} aria-hidden="true" /> Check-in from 2 PM · check-out by 11 AM</li>
                <li className="inline-flex items-center gap-2"><CalendarX className="size-4 shrink-0" style={{ color: "var(--olive)" }} aria-hidden="true" /> Free cancellation up to {s.cancelWindowHours} hours before check-in</li>
                <li className="inline-flex items-center gap-2"><BadgeIndianRupee className="size-4 shrink-0" style={{ color: "var(--olive)" }} aria-hidden="true" /> Pay online or at the hotel · GST invoice provided</li>
              </ul>
            </section>
          </div>

          {/* Booking card */}
          <aside id="book" className="scroll-mt-24 lg:sticky lg:top-24 lg:h-fit">
            {s.fromPaise !== null && (
              <p className="mb-2 text-sm" style={{ color: "var(--timber)" }}>
                From <span className="serif text-2xl font-bold" style={{ color: "var(--forest)" }}>{rupees(s.fromPaise)}</span>/night · incl. GST
              </p>
            )}
            <BookingWidget slug={s.slug} propertyName={s.propertyName} />
          </aside>
        </div>
      </main>

      <footer className="mt-16 border-t" style={{ borderColor: "var(--border)" }}>
        <div className="mx-auto w-full max-w-6xl px-4 py-8 text-center text-xs" style={{ color: "var(--timber)" }}>
          © {new Date().getFullYear()} Woodpecker Apartments &amp; Suites Pvt. Ltd. · {s.propertyName}, {s.city}
        </div>
      </footer>
    </div>
  );
}

function RoomTypeCard({ room }: { room: ShowcaseRoomType }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-sm border bg-white shadow-sm sm:flex-row" style={{ borderColor: "var(--border)" }}>
      {room.imageUrls[0] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={room.imageUrls[0]} alt={room.name} loading="lazy" className="h-44 w-full object-cover sm:h-auto sm:w-56 sm:shrink-0" />
      ) : (
        <div className="grid h-44 w-full place-items-center sm:h-auto sm:w-56 sm:shrink-0" style={{ background: "var(--muted-hsl,#EFE8DA)" }}><MapPin className="size-6 opacity-40" aria-hidden="true" /></div>
      )}
      <div className="flex min-w-0 flex-1 flex-col p-5">
        <h3 className="serif text-lg font-semibold" style={{ color: "var(--forest)" }}>{room.name}</h3>
        {room.description ? <p className="mt-1 line-clamp-2 text-sm" style={{ color: "var(--timber)" }}>{room.description}</p> : null}
        {room.amenities.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {room.amenities.slice(0, 4).map((a) => (
              <li key={a} className="inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs" style={{ background: "#EFE8DA", color: "var(--timber)" }}>
                <Check className="size-3" aria-hidden="true" /> {a}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex items-end justify-between gap-3 pt-1">
          <p className="text-sm" style={{ color: "var(--timber)" }}>
            From <span className="serif font-bold" style={{ color: "var(--forest)" }}>{rupees(room.fromPaise)}</span>/night
          </p>
          <a href="#book" className="stay-btn stay-btn-onlight" style={{ minHeight: "2.5rem", padding: "0 1rem" }}>
            Select <ArrowRight className="size-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  );
}
