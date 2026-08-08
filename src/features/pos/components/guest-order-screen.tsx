"use client";

/**
 * Public in-room guest ordering screen (19 addendum, FR-21). Mobile-first, no auth
 * chrome. The guest builds a cart from the room-dining menu and submits; the
 * server re-prices every line (this total is display-only) and the order lands in
 * the staff Room-orders inbox as REQUESTED. No payment here — it's added to the
 * room bill after staff accept.
 */
import { useMemo, useState, useTransition } from "react";
import { Minus, Plus, UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { submitGuestOrder } from "../guest-actions";
import type { GuestMenuItem } from "../guest-queries";

const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;

export function GuestOrderScreen({
  token,
  roomNumber,
  items,
}: {
  token: string;
  roomNumber: string;
  items: GuestMenuItem[];
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const setItem = (id: string, delta: number) =>
    setQty((q) => {
      const next = Math.max(0, (q[id] ?? 0) + delta);
      return { ...q, [id]: next };
    });

  const lines = useMemo(
    () => items.filter((i) => (qty[i.id] ?? 0) > 0).map((i) => ({ item: i, quantity: qty[i.id]! })),
    [items, qty],
  );
  const subtotal = useMemo(() => lines.reduce((s, l) => s + l.item.ratePaise * l.quantity, 0), [lines]);

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await submitGuestOrder({
        token,
        lines: lines.map((l) => ({ menuItemId: l.item.id, quantity: l.quantity })),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      if (res.ok) setDone(true);
      else setError(res.error.message);
    });
  };

  if (done) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2 p-6 text-center">
        <div className="grid size-12 place-items-center rounded-full bg-success/12 text-success">
          <UtensilsCrossed className="size-6" />
        </div>
        <h1 className="text-lg font-semibold" data-testid="order-sent">Order sent</h1>
        <p className="text-sm text-muted-foreground">
          Room {roomNumber} — the front desk will confirm and it&apos;ll be added to your room bill.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-md space-y-4 p-4">
      <header>
        <h1 className="text-xl font-semibold">Order to Room {roomNumber}</h1>
        <p className="text-sm text-muted-foreground">Added to your room bill — no payment now.</p>
      </header>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">The menu is empty right now.</p>
      ) : (
        <ul className="divide-y rounded-lg border" data-testid="guest-menu">
          {items.map((i) => {
            const n = qty[i.id] ?? 0;
            return (
              <li key={i.id} className="flex items-center justify-between gap-3 p-3" data-testid={`menu-${i.id}`}>
                <div className="min-w-0">
                  <p className="font-medium">{i.name}</p>
                  <p className="text-xs text-muted-foreground">{inr(i.ratePaise)} + GST</p>
                </div>
                <div className="flex items-center gap-2">
                  {n > 0 && (
                    <>
                      <Button variant="outline" size="icon" onClick={() => setItem(i.id, -1)} aria-label={`Remove one ${i.name}`}>
                        <Minus className="size-4" />
                      </Button>
                      <span className="w-5 text-center tabular-nums" data-testid={`qty-${i.id}`}>{n}</span>
                    </>
                  )}
                  <Button size="icon" onClick={() => setItem(i.id, 1)} aria-label={`Add one ${i.name}`} data-testid={`add-${i.id}`}>
                    <Plus className="size-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-1.5">
        <label htmlFor="guest-note" className="text-sm font-medium">Note (optional)</label>
        <Input id="guest-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="No onions, extra napkins…" maxLength={300} />
      </div>

      {error && <p role="alert" className="text-sm text-destructive" data-testid="order-error">{error}</p>}

      <div className="sticky bottom-0 -mx-4 border-t bg-background p-4">
        <Button
          block
          size="lg"
          disabled={pending || lines.length === 0}
          onClick={submit}
          data-testid="guest-submit"
        >
          {lines.length === 0 ? "Add items to order" : `Send order · ${inr(subtotal)}+GST`}
        </Button>
      </div>
    </main>
  );
}
