"use client";

/**
 * Room-orders inbox (19 addendum, FR-22/25). Live list of guest QR orders awaiting
 * staff action. Accept posts to the room folio (via the existing settleToFolio) and
 * sends to the kitchen; Reject voids with a reason and charges nothing. Updates live
 * via the Module-17 SSE (GuestOrderRequested).
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useRealtime } from "@/hooks/use-realtime";
import { acceptGuestOrder, rejectGuestOrder } from "../guest-actions";
import type { RoomOrderInboxItem } from "../queries";

const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;

export function RoomOrdersInbox({ orders }: { orders: RoomOrderInboxItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  useRealtime({ types: ["GuestOrderRequested"] });

  const accept = (o: RoomOrderInboxItem) =>
    start(async () => {
      const res = await acceptGuestOrder({ orderId: o.id });
      if (res.ok) {
        toast.success(`Accepted ${o.code} — added to room ${o.roomNumber ?? ""} bill`);
        router.refresh();
      } else {
        toast.error(res.error.message);
      }
    });

  const reject = (o: RoomOrderInboxItem) =>
    start(async () => {
      const res = await rejectGuestOrder({ orderId: o.id, reason: "Declined at front desk" });
      if (res.ok) {
        toast.success(`Rejected ${o.code}`);
        router.refresh();
      } else {
        toast.error(res.error.message);
      }
    });

  if (orders.length === 0) return null;

  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          Room orders
          <Badge variant="warning" data-testid="inbox-count">{orders.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2" data-testid="room-orders-inbox">
          {orders.map((o) => (
            <li key={o.id} className="rounded-md border p-3" data-testid={`inbox-${o.code}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {o.roomNumber ? `Room ${o.roomNumber}` : o.code} · {inr(o.totalPaise)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                  </p>
                  {o.guestNote ? <p className="mt-0.5 text-xs italic text-muted-foreground">“{o.guestNote}”</p> : null}
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                <Button size="sm" disabled={pending} onClick={() => accept(o)} data-testid={`accept-${o.code}`}>
                  Accept
                </Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => reject(o)} data-testid={`reject-${o.code}`}>
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
