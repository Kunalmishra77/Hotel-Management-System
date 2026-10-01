import type { Metadata } from "next";
import { db } from "@/lib/db";
import { verifyReviewToken } from "@/features/feedback/review-token";
import { ReviewForm } from "@/features/feedback/components/review-form";

export const metadata: Metadata = { title: "Share your feedback" };
export const dynamic = "force-dynamic";

/** Public, token-gated guest feedback page (#26) — no session; outside the app shell. */
export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const reservationId = verifyReviewToken(token);
  const reservation = reservationId
    ? await db.unscoped().reservation.findFirst({
        where: { id: reservationId },
        select: { guest: { select: { fullName: true } }, property: { select: { name: true } } },
      })
    : null;
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
      <div className="text-center">
        <p className="font-serif text-lg font-semibold tracking-tight">Woodpecker Apartments &amp; Suites</p>
      </div>
      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        {reservation ? (
          <ReviewForm
            token={token}
            guestName={firstName(reservation.guest?.fullName)}
            propertyName={reservation.property?.name ?? "your stay"}
            bookUrl={`${base}/book`}
          />
        ) : (
          <div className="space-y-2 text-center">
            <h1 className="text-lg font-semibold">Link not valid</h1>
            <p className="text-sm text-muted-foreground">This feedback link is invalid or has expired. Please scan the latest QR at reception.</p>
          </div>
        )}
      </div>
    </main>
  );
}

function firstName(full?: string | null): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}
