import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { loadPublishedConfig } from "@/features/booking-engine/queries";
import { requireGuest } from "@/features/guest-account/queries";
import { GuestBooking } from "@/features/guest-account/components/guest-booking";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const cfg = await loadPublishedConfig(slug);
  return { title: cfg ? `Book ${cfg.propertyName} · Woodpecker` : "Book · Woodpecker" };
}

export default async function GuestBookPropertyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const principal = await requireGuest(`/account/book/${slug}`);
  const cfg = await loadPublishedConfig(slug);
  // Only bookable if the site is published AND belongs to the guest's org.
  if (!cfg || cfg.orgId !== principal.orgId) notFound();

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8">
      <Link
        href="/account/book"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" /> All properties
      </Link>
      <GuestBooking slug={cfg.slug} propertyName={cfg.propertyName} cancelWindowHours={cfg.cancelWindowHours} />
    </main>
  );
}
