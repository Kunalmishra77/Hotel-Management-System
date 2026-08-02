/**
 * Public booking site — 23 T-18/T-19. UNAUTHENTICATED, outside (dashboard). The
 * page only resolves the property's public name from a PUBLISHED slug; all
 * availability/pricing/booking happens client-side against the public API.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
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
    <main className="mx-auto w-full max-w-md space-y-4 p-4">
      <BookingWidget slug={cfg.slug} propertyName={cfg.propertyName} />
      <p className="text-center text-xs text-muted-foreground">Secure booking · GST-inclusive prices</p>
    </main>
  );
}
