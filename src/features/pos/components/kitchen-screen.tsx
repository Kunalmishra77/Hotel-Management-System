"use client";

/**
 * Kitchen screen — 19 (FR-13/24/25). Two views: the live per-ticket lifecycle
 * board (advance QUEUED→PREPARING→READY→SERVED, one tap) and the aggregated prep
 * list. Updates live via the Module-17 SSE (KitchenTicketMoved / GuestOrderRequested)
 * — no manual refresh needed.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRealtime } from "@/hooks/use-realtime";
import { nextTicketStatus, type TicketStatus } from "../domain/kitchen-ticket";
import { startTicket, readyTicket, serveTicket } from "../kitchen-actions";
import type { PrepLine } from "../domain/kot";
import type { KitchenTicketView } from "../queries";

const NEXT_LABEL: Record<Exclude<TicketStatus, "SERVED">, string> = {
  QUEUED: "Start",
  PREPARING: "Mark ready",
  READY: "Mark served",
};
const ADVANCE: Record<Exclude<TicketStatus, "SERVED">, (i: { ticketId: string }) => Promise<{ ok: boolean; error?: { message: string } }>> = {
  QUEUED: startTicket,
  PREPARING: readyTicket,
  READY: serveTicket,
};
const STATUS_VARIANT: Record<TicketStatus, "secondary" | "warning" | "success"> = {
  QUEUED: "secondary",
  PREPARING: "warning",
  READY: "success",
  SERVED: "secondary",
};

export function KitchenScreen({ prep, tickets }: { prep: PrepLine[]; tickets: KitchenTicketView[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // Live board (17): a new guest order or any ticket move re-pulls this screen.
  useRealtime({ types: ["KitchenTicketMoved", "GuestOrderRequested"] });

  const advance = (t: KitchenTicketView) => {
    const from = t.status as Exclude<TicketStatus, "SERVED">;
    const fn = ADVANCE[from];
    if (!fn) return;
    start(async () => {
      const res = await fn({ ticketId: t.id });
      if (res.ok) router.refresh();
      else toast.error(res.error?.message ?? "Couldn't update the ticket.");
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Kitchen</h1>
        <Button size="sm" variant="outline" onClick={() => router.refresh()} data-testid="kitchen-refresh">
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Tickets</CardTitle>
        </CardHeader>
        <CardContent>
          {tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active tickets.</p>
          ) : (
            <ul className="space-y-2" data-testid="kitchen-tickets">
              {tickets.map((t) => {
                const next = nextTicketStatus(t.status);
                return (
                  <li key={t.id} className="rounded-md border p-3" data-testid={`ticket-${t.orderCode}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-medium">
                          {t.orderCode}
                          <Badge variant={STATUS_VARIANT[t.status]}>{t.status}</Badge>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {t.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                        </p>
                      </div>
                      {next && t.status !== "SERVED" ? (
                        <Button
                          size="lg"
                          disabled={pending}
                          onClick={() => advance(t)}
                          data-testid={`advance-${t.orderCode}`}
                        >
                          {NEXT_LABEL[t.status as Exclude<TicketStatus, "SERVED">]}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Prep queue</CardTitle>
        </CardHeader>
        <CardContent>
          {prep.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to prepare right now.</p>
          ) : (
            <ul className="divide-y rounded-md border" data-testid="kitchen-prep">
              {prep.map((p) => (
                <li key={p.key} className="flex items-center justify-between p-3 text-base" data-testid={`prep-${p.key}`}>
                  <span className="font-medium">{p.name}</span>
                  <span className="font-semibold">×{p.quantity}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
