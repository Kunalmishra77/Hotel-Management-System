import type { Metadata } from "next";
import { getGuestMenu } from "@/features/pos/guest-queries";
import { GuestOrderScreen } from "@/features/pos/components/guest-order-screen";

export const metadata: Metadata = {
  title: "Order to your room",
  robots: { index: false, follow: false },
};

/**
 * Public in-room QR ordering page (19 addendum, FR-20). No session. `getGuestMenu`
 * applies the occupied-gate + token check and returns menu data only; a null
 * result renders a generic "unavailable" (never leaks why — FR-26).
 */
export default async function GuestOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const menu = await getGuestMenu(token);

  if (!menu) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-lg font-semibold">Ordering unavailable</h1>
        <p className="text-sm text-muted-foreground" data-testid="order-unavailable">
          In-room ordering isn&apos;t available right now. Please contact the front desk.
        </p>
      </main>
    );
  }

  return <GuestOrderScreen token={token} roomNumber={menu.roomNumber} items={menu.items} />;
}
