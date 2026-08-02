/**
 * Public self-service booking management page — 23 T-16. Reads the signed token
 * from the query string; all authority is in the signature (no login).
 */
import type { Metadata } from "next";
import { ManageView } from "@/features/booking-engine/components/manage-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Manage booking" };

export default async function ManageBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { slug } = await params;
  const { t } = await searchParams;

  return (
    <main className="mx-auto w-full max-w-md space-y-4 p-4">
      <h1 className="text-lg font-semibold">Manage your booking</h1>
      {t ? <ManageView slug={slug} token={t} /> : <p className="text-sm text-destructive">Missing booking link.</p>}
    </main>
  );
}
