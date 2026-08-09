import type { Metadata } from "next";
import { resolveTrackingToken } from "@/features/staff/field-internal";
import { FieldTracker } from "@/features/staff/components/field-tracker";

export const metadata: Metadata = { title: "On-duty tracker" };

/**
 * 09 addendum — PUBLIC field-staff tracker (FR-17). No session; the token is the
 * credential. Shows a consent notice; on accept the device shares location while
 * the page stays open. An unknown/disabled token shows a generic inactive message.
 */
export default async function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const target = await resolveTrackingToken(token);

  if (!target) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-lg font-semibold">Tracking link inactive</h1>
        <p className="text-sm text-muted-foreground">This link is not active. Please contact your manager.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md p-6">
      <FieldTracker token={token} staffName={target.staffName} />
    </main>
  );
}
