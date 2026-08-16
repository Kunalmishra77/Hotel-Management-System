/**
 * Public property page — the OTA-style hotel page (photos · overview · amenities ·
 * room types · location · policies) with a booking card. UNAUTHENTICATED, outside
 * (dashboard). Content is date-independent (loadPropertyShowcase); availability +
 * booking happen in the BookingWidget against the public API.
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

export const dynamic = "force-dynamic";

const rupees = (paise: number): string => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const s = await loadPropertyShowcase(slug);
  return {
    title: s ? `${s.propertyName}, ${s.city} — Book direct · Woodpecker` : "Booking",
    description: s ? `Book ${s.propertyName} in ${s.city} direct — GST-inclusive rates, instant confirmation, no OTA markup.` : undefined,
  };
}

export default async function PropertyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await loadPropertyShowcase(slug);
  if (!s) notFound();

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight text-primary">Woodpecker</span>
            <span className="hidden text-sm text-muted-foreground sm:inline">Apartments &amp; Suites</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/account" className="hidden text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:inline">Sign in</Link>
            <a href="#book" className="inline-flex min-h-touch items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:opacity-90">
              Book now
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        {/* Title */}
        <div className="mb-4">
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{s.propertyName}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden="true" /> {s.addressLine1}, {s.city}, {s.state}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
              <Star className="size-3.5 fill-current" aria-hidden="true" /> 4.6 · Serviced apartments
            </span>
          </div>
        </div>

        {/* Gallery */}
        <PropertyGallery images={s.heroImages} alt={s.propertyName} />

        {/* Body: content + sticky booking card */}
        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_360px]">
          <div className="min-w-0 space-y-8">
            {/* Overview */}
            <section>
              <h2 className="font-display text-xl font-semibold tracking-tight">A home-like stay, run like a hotel</h2>
              <p className="mt-2 text-pretty text-muted-foreground">
                Spacious serviced apartments in {s.city} for business and leisure — daily housekeeping, a 24×7 front
                desk, and a full kitchen. Book direct for the best rate: prices are GST-inclusive and confirmed instantly.
              </p>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-4 text-primary" aria-hidden="true" /> Secure booking</span>
                <span className="inline-flex items-center gap-1.5"><BadgeIndianRupee className="size-4 text-primary" aria-hidden="true" /> GST-inclusive</span>
                <span className="inline-flex items-center gap-1.5"><Zap className="size-4 text-primary" aria-hidden="true" /> Instant confirmation</span>
              </div>
            </section>

            {/* Amenities */}
            {s.amenities.length > 0 && (
              <section>
                <h2 className="font-display text-xl font-semibold tracking-tight">What this place offers</h2>
                <ul className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {s.amenities.map((a) => {
                    const Icon = amenityIcon(a);
                    return (
                      <li key={a} className="inline-flex items-center gap-2 text-sm">
                        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> {a}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {/* Room types */}
            <section id="rooms">
              <h2 className="font-display text-xl font-semibold tracking-tight">Choose your room</h2>
              <div className="mt-3 space-y-3">
                {s.roomTypes.map((r) => <RoomTypeCard key={r.id} room={r} />)}
              </div>
            </section>

            {/* Location */}
            <section>
              <h2 className="font-display text-xl font-semibold tracking-tight">Where you&apos;ll be</h2>
              <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="size-4 text-primary" aria-hidden="true" /> {s.addressLine1}, {s.city}, {s.state}
              </p>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.propertyName}, ${s.addressLine1}, ${s.city}`)}`}
                target="_blank" rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Open in Google Maps <ArrowRight className="size-3.5" aria-hidden="true" />
              </a>
            </section>

            {/* Policies */}
            <section>
              <h2 className="font-display text-xl font-semibold tracking-tight">Good to know</h2>
              <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                <li className="inline-flex items-center gap-2"><Clock className="size-4 shrink-0 text-primary" aria-hidden="true" /> Check-in from 2 PM · check-out by 11 AM</li>
                <li className="inline-flex items-center gap-2"><CalendarX className="size-4 shrink-0 text-primary" aria-hidden="true" /> Free cancellation up to {s.cancelWindowHours} hours before check-in</li>
                <li className="inline-flex items-center gap-2"><BadgeIndianRupee className="size-4 shrink-0 text-primary" aria-hidden="true" /> Pay online or at the hotel · GST invoice provided</li>
              </ul>
            </section>
          </div>

          {/* Booking card */}
          <aside id="book" className="lg:sticky lg:top-20 lg:h-fit">
            {s.fromPaise !== null && (
              <p className="mb-2 text-sm text-muted-foreground">
                From <span className="font-display text-2xl font-bold text-foreground">{rupees(s.fromPaise)}</span>/night · incl. GST
              </p>
            )}
            <BookingWidget slug={s.slug} propertyName={s.propertyName} />
          </aside>
        </div>
      </main>

      <footer className="border-t">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Woodpecker Apartments &amp; Suites Pvt. Ltd. · {s.propertyName}, {s.city}
        </div>
      </footer>
    </div>
  );
}

function RoomTypeCard({ room }: { room: ShowcaseRoomType }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm sm:flex-row">
      {room.imageUrls[0] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={room.imageUrls[0]} alt={room.name} loading="lazy" className="h-40 w-full object-cover sm:h-auto sm:w-52 sm:shrink-0" />
      ) : (
        <div className="grid h-40 w-full place-items-center bg-muted text-muted-foreground sm:h-auto sm:w-52 sm:shrink-0"><MapPin className="size-6 opacity-40" aria-hidden="true" /></div>
      )}
      <div className="flex min-w-0 flex-1 flex-col p-4">
        <h3 className="font-semibold">{room.name}</h3>
        {room.description ? <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{room.description}</p> : null}
        {room.amenities.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {room.amenities.slice(0, 4).map((a) => (
              <li key={a} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                <Check className="size-3" aria-hidden="true" /> {a}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex items-end justify-between gap-3 pt-1">
          <p className="text-sm text-muted-foreground">
            From <span className="font-semibold text-foreground">{rupees(room.fromPaise)}</span>/night
          </p>
          <a href="#book" className="inline-flex min-h-touch items-center gap-1.5 rounded-md border border-primary px-3 text-sm font-medium text-primary hover:bg-primary/5">
            Select <ArrowRight className="size-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  );
}
