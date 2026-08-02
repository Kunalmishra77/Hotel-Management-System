"use client";

/**
 * POS order screen — 19 T-17/T-18 (AC-1/2/5/7/12). Mobile-first, one-thumb:
 * outlet tabs, a tap-to-add menu grid, the live bill, and settle actions. All
 * money is server-computed (the DERIVED preview on the order); this UI never
 * recomputes a total it then trusts. Server round-trip + refresh keeps the bill
 * exactly equal to what 06 will post.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createOrder, addItem, removeItem, applyDiscount, sendToKitchen } from "../actions";
import { settleToFolio, settleDirect } from "../settle-actions";
import type { OutletView, MenuItemView, PosOrderView } from "../queries";

const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type ActionResult = { ok: boolean; error?: { message: string } };

export function PosScreen({
  outlets,
  outletId,
  menu,
  openOrders,
  activeOrder,
  defaultReservationId,
}: {
  outlets: OutletView[];
  outletId: string;
  menu: MenuItemView[];
  openOrders: PosOrderView[];
  activeOrder: PosOrderView | null;
  defaultReservationId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reservationId, setReservationId] = useState(defaultReservationId);
  const [discount, setDiscount] = useState(0);
  const [customerName, setCustomerName] = useState("Walk-in Guest");
  const [tenderMode, setTenderMode] = useState<"CASH" | "CREDIT_CARD" | "DEBIT_CARD" | "UPI">("CASH");

  const nav = (params: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    if (params.outletId ?? outletId) q.set("outletId", params.outletId ?? outletId);
    if (params.orderId) q.set("orderId", params.orderId);
    if (params.reservationId) q.set("reservationId", params.reservationId);
    router.push(`/pos?${q.toString()}`);
  };

  const run = (fn: () => Promise<ActionResult>, onOk?: (r: ActionResult) => void) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) { onOk?.(res); router.refresh(); }
      else setError(res.error?.message ?? "Something went wrong.");
    });
  };

  const newOrder = () =>
    run(
      () => createOrder({ outletId, reservationId: reservationId || undefined }),
      (r) => { const d = (r as { data?: { id: string } }).data; if (d) nav({ orderId: d.id, reservationId: reservationId || undefined }); },
    );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">POS</h1>
        <a href="/pos/kitchen" className="text-sm text-primary underline" data-testid="pos-kitchen-link">Kitchen ›</a>
      </div>

      {/* Outlet tabs */}
      <div className="flex flex-wrap gap-2" data-testid="pos-outlets">
        {outlets.map((o) => (
          <Button key={o.id} size="sm" variant={o.id === outletId ? "default" : "outline"} onClick={() => nav({ outletId: o.id })} data-testid={`outlet-${o.id}`}>
            {o.name}
          </Button>
        ))}
      </div>

      {error && <p role="alert" className="text-sm text-destructive" data-testid="pos-error">{error}</p>}

      {!activeOrder ? (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Start an order</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pos-res">In-house reservation (optional)</Label>
              <Input id="pos-res" value={reservationId} onChange={(e) => setReservationId(e.target.value)} placeholder="reservation id — leave blank for walk-in" data-testid="pos-reservation" />
            </div>
            <Button size="lg" disabled={pending} onClick={newOrder} data-testid="pos-new-order">New order</Button>

            {openOrders.length > 0 && (
              <ul className="divide-y rounded-md border" data-testid="pos-open-orders">
                {openOrders.map((o) => (
                  <li key={o.id} className="flex items-center justify-between p-3 text-sm">
                    <span>{o.code} · {rupees(o.totalPaise)}</span>
                    <Button size="sm" variant="outline" onClick={() => nav({ orderId: o.id })} data-testid={`open-${o.id}`}>Open</Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Menu grid */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Menu</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="pos-menu">
                {menu.map((m) => (
                  <Button key={m.id} variant="outline" className="h-auto min-h-16 flex-col items-start py-2" disabled={pending}
                    onClick={() => run(() => addItem({ orderId: activeOrder.id, menuItemId: m.id, quantity: 1 }))}
                    data-testid={`menu-${m.id}`}>
                    <span className="font-medium">{m.name}</span>
                    <span className="text-xs text-muted-foreground">{rupees(m.ratePaise)}</span>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Current bill */}
          <Card data-testid="pos-bill">
            <CardHeader className="pb-3"><CardTitle className="text-base">Order {activeOrder.code}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {activeOrder.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Tap the menu to add items.</p>
              ) : (
                <ul className="divide-y rounded-md border" data-testid="pos-items">
                  {activeOrder.items.map((it) => (
                    <li key={it.id} className="flex items-center justify-between gap-2 p-2 text-sm">
                      <span>{it.name} ×{it.quantity}</span>
                      <span className="flex items-center gap-2">
                        {rupees(it.amountPaise)}
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => removeItem({ orderId: activeOrder.id, itemId: it.id }))} aria-label={`Remove ${it.name}`} data-testid={`remove-${it.id}`}>✕</Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <dl className="space-y-1 text-sm">
                <div className="flex justify-between"><dt>Subtotal</dt><dd data-testid="bill-subtotal">{rupees(activeOrder.subtotalPaise)}</dd></div>
                {activeOrder.discountPaise > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>−{rupees(activeOrder.discountPaise)}</dd></div>}
                <div className="flex justify-between"><dt>CGST</dt><dd>{rupees(activeOrder.cgstPaise)}</dd></div>
                <div className="flex justify-between"><dt>SGST</dt><dd>{rupees(activeOrder.sgstPaise)}</dd></div>
                {activeOrder.roundOffPaise !== 0 && <div className="flex justify-between"><dt>Round off</dt><dd>{rupees(activeOrder.roundOffPaise)}</dd></div>}
                <div className="flex justify-between font-semibold"><dt>Total</dt><dd data-testid="bill-total">{rupees(activeOrder.totalPaise)}</dd></div>
              </dl>

              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="pos-disc">Discount (₹)</Label>
                  <Input id="pos-disc" type="number" inputMode="numeric" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} data-testid="pos-discount" />
                </div>
                <Button variant="outline" disabled={pending} onClick={() => run(() => applyDiscount({ orderId: activeOrder.id, amountPaise: Math.round(discount * 100), reason: "counter discount" }))} data-testid="pos-apply-discount">Apply</Button>
              </div>
            </CardContent>
          </Card>

          {/* Settle */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Settle</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Button size="lg" variant="secondary" className="w-full" disabled={pending || activeOrder.items.length === 0} onClick={() => run(() => sendToKitchen({ orderId: activeOrder.id }))} data-testid="pos-kot">Send to kitchen (KOT)</Button>

              <Button size="lg" className="w-full" disabled={pending || !activeOrder.reservationId || activeOrder.items.length === 0}
                onClick={() => run(() => settleToFolio({ orderId: activeOrder.id }), () => nav({}))} data-testid="pos-settle-folio">
                Settle → folio {activeOrder.reservationId ? "" : "(link a reservation)"}
              </Button>

              <div className="space-y-2 rounded-md border p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label htmlFor="pos-cust">Customer</Label><Input id="pos-cust" value={customerName} onChange={(e) => setCustomerName(e.target.value)} data-testid="pos-customer" /></div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pos-tender">Tender</Label>
                    <select id="pos-tender" value={tenderMode} onChange={(e) => setTenderMode(e.target.value as typeof tenderMode)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="pos-tender">
                      {["CASH", "CREDIT_CARD", "DEBIT_CARD", "UPI"].map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
                <Button size="lg" variant="outline" className="w-full" disabled={pending || activeOrder.items.length === 0}
                  onClick={() => run(() => settleDirect({ orderId: activeOrder.id, customerName, tender: { mode: tenderMode } }), () => nav({}))} data-testid="pos-settle-direct">
                  Settle direct
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
