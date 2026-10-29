"use client";

/**
 * Folio screen — 06 T-26/27/28 (AC-2/8/16). Shows charges + payments + the DERIVED
 * balance (never a stored column), with the front-desk actions: add a charge, take
 * a split payment (remaining → 0 to confirm), apply a discount, generate the GST
 * invoice. Mobile-first: numeric keypads, ≥44px actions. Amounts entered in ₹.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { postFolioCharge, applyDiscount, reverseFolioLine, correctRoomRate } from "../charge-actions";
import { recordPayment } from "../payment-actions";
import { generateInvoice, voidInvoice } from "../invoice-actions";
import { BillToForm, InvoiceHistory } from "./invoice-panel";
import { addAddOnToReservation } from "@/features/add-ons/actions";
import { setRoomRate } from "@/features/reservations/move-actions";
import { gstBpsForCharge } from "@/lib/constants/gst";
import type { FolioView } from "../queries";

type AddOnOption = { id: string; name: string; pricePaise: number };

const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;
const toPaise = (r: number) => Math.round(r * 100);

type Tender = { mode: string; amountPaise: number };

export function FolioScreen({
  folio,
  guestName,
  reservationId,
  addOns = [],
}: {
  folio: FolioView;
  guestName: string;
  reservationId?: string;
  addOns?: AddOnOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"none" | "charge" | "pay" | "discount" | "addon" | "roomrate" | "invoice">("none");
  const hasRoomCharge = folio.lines.some((l) => l.type === "ROOM");
  const [invoice, setInvoice] = useState<{ id: string; number: string } | null>(null);
  const [reverseTarget, setReverseTarget] = useState<{ id: string; description: string } | null>(null);
  const [voidTarget, setVoidTarget] = useState<{ id: string; number: string } | null>(null);

  // Version history: an invoice is "voided" when a CREDIT_NOTE cancels it. The
  // active bill is the latest TAX_INVOICE that has not been credited.
  const voidedIds = new Set(folio.invoices.filter((i) => i.cancelsInvoiceId).map((i) => i.cancelsInvoiceId!));
  const activeInvoice = [...folio.invoices].reverse().find((i) => i.type === "TAX_INVOICE" && !voidedIds.has(i.id)) ?? null;
  // The invoice is a frozen snapshot. If charges were added AFTER it was issued
  // (e.g. food after the room bill), the invoice no longer matches the folio —
  // warn so staff void & re-issue a single correct bill (room + food together).
  const folioChargeTotalPaise = folio.lines.reduce((a, l) => a + l.amountPaise + l.cgstPaise + l.sgstPaise + l.igstPaise, 0);
  const invoiceStale = !!activeInvoice && activeInvoice.totalPaise !== folioChargeTotalPaise;

  // A revised bill starts from the last bill's name/GSTIN (it may have been a
  // company bill); a first bill starts from the guest's name.
  const lastBill = [...folio.invoices].reverse().find((i) => i.type === "TAX_INVOICE") ?? null;
  const generate = (customerName: string, customerGstin: string | undefined) => {
    setError(null);
    start(async () => {
      const res = await generateInvoice({ folioId: folio.id, customerName, customerGstin });
      if (res.ok) { setInvoice({ id: res.data.invoiceId, number: res.data.number }); setMode("none"); router.refresh(); }
      else setError(res.error.message);
    });
  };

  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) { setMode("none"); router.refresh(); }
      else setError(res.error?.message ?? "Something went wrong.");
    });
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Folio · {guestName}</h1>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Main column — charges & bills fill the width */}
        <div className="space-y-4 lg:col-span-2">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Charges & payments</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm" data-testid="folio-lines">
          {(() => {
            // A reversed line + its reversal cancel out — show only the NET current
            // charges (a 'Fix room rate' leaves the final corrected line here), and
            // tuck the reversed/adjusted pairs into a collapsed "Corrections" block.
            const reversedIds = new Set(folio.lines.filter((l) => l.reversalOfId).map((l) => l.reversalOfId!));
            const activeLines = folio.lines.filter((l) => l.type !== "REVERSAL" && !reversedIds.has(l.id));
            const corrections = folio.lines.filter((l) => l.type === "REVERSAL" || reversedIds.has(l.id));
            const lineRow = (l: typeof folio.lines[number], showReverse: boolean) => (
              <div key={l.id} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{l.type} · {l.description}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular">{rupees(l.amountPaise + l.cgstPaise + l.sgstPaise + l.igstPaise)}</span>
                  {showReverse && l.type !== "TAX" && l.type !== "REVERSAL" && (
                    <button type="button" onClick={() => setReverseTarget({ id: l.id, description: l.description })}
                      className="text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline" data-testid="reverse-line">
                      reverse
                    </button>
                  )}
                </span>
              </div>
            );
            return (
              <>
                {activeLines.map((l) => lineRow(l, true))}
                {corrections.length > 0 && (
                  <details className="rounded-md border bg-muted/20 p-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">Corrections (history) · {corrections.length} reversed line(s)</summary>
                    <div className="mt-2 space-y-1">{corrections.map((l) => lineRow(l, false))}</div>
                  </details>
                )}
              </>
            );
          })()}
          {folio.payments.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">
                Payment · {p.mode}{p.isRefund ? " (refund)" : ""}
                <span className="ml-1 text-xs">· {new Date(p.receivedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
                <a href={`/api/receipts/${p.id}`} target="_blank" rel="noopener noreferrer"
                  className="ml-2 text-xs text-primary underline underline-offset-2" data-testid="receipt-link">receipt</a>
              </span>
              <span>{p.isRefund ? "+" : "−"} {rupees(p.amountPaise)}</span>
            </div>
          ))}
          {(() => {
            const taxable = folio.lines.reduce((a, l) => a + l.amountPaise, 0);
            const tax = folio.lines.reduce((a, l) => a + l.cgstPaise + l.sgstPaise + l.igstPaise, 0);
            const paid = folio.payments.reduce((a, p) => a + (p.isRefund ? -p.amountPaise : p.amountPaise), 0);
            return (
              <div className="mt-2 space-y-1 border-t pt-2">
                <div className="flex justify-between text-muted-foreground"><span>Taxable value</span><span className="tabular">{rupees(taxable)}</span></div>
                <div className="flex justify-between text-muted-foreground"><span>GST</span><span className="tabular">{rupees(tax)}</span></div>
                <div className="flex justify-between font-medium"><span>Total</span><span className="tabular">{rupees(taxable + tax)}</span></div>
                <div className="flex justify-between text-muted-foreground"><span>Paid</span><span className="tabular">− {rupees(paid)}</span></div>
                <div className="mt-1 flex justify-between border-t pt-1.5 text-base font-semibold">
                  <span>Balance due</span><span data-testid="folio-balance">{rupees(folio.balancePaise)}</span>
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {folio.invoices.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Bills &amp; version history</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm" data-testid="invoice-history">
            {/* Tap any bill: who it was billed to, tax breakup, PDF, download, void & revise. */}
            <InvoiceHistory invoices={folio.invoices} pending={pending} canVoid onVoid={setVoidTarget} />
            {invoiceStale && activeInvoice && (
              <div className="mt-1 rounded-md border border-warning/50 bg-warning/10 p-2.5 text-sm" data-testid="invoice-stale">
                <p className="font-medium text-warning">⚠ Bill {activeInvoice.number} is out of date</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  It was issued for {rupees(activeInvoice.totalPaise)}, but the folio now totals {rupees(folioChargeTotalPaise)} — newer charges (e.g. food) aren&apos;t on it. <b>Void &amp; revise</b>, then <b>Generate GST invoice</b> to issue one bill with everything.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
        </div>

        {/* Actions rail — sticky on desktop */}
        <div className="space-y-3 lg:sticky lg:top-2 lg:self-start">
      {voidTarget && (
        <VoidForm number={voidTarget.number} pending={pending}
          onSubmit={(reason) => { const id = voidTarget.id; setVoidTarget(null); run(() => voidInvoice({ invoiceId: id, reason })); }}
          onCancel={() => setVoidTarget(null)} />
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {invoice && (
        <p className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm" data-testid="invoice-number">
          <span>Invoice generated: <span className="font-mono font-medium">{invoice.number}</span></span>
          <a href={`/api/invoices/${invoice.id}`} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-4">View PDF</a>
        </p>
      )}

      {reverseTarget && (
        <ReverseForm description={reverseTarget.description} pending={pending}
          onSubmit={(reason) => { const id = reverseTarget.id; setReverseTarget(null); run(() => reverseFolioLine({ lineId: id, reason })); }}
          onCancel={() => setReverseTarget(null)} />
      )}
      {mode === "roomrate" && (
        <RoomRateForm
          pending={pending}
          hasRoomCharge={hasRoomCharge}
          // No room charge yet (e.g. an OTA stay saved at ₹0): go through the
          // booking's rate action, which posts every stayed night at this rate and
          // raises the GST invoice. Otherwise re-price the posted nights here.
          onSubmit={(rate, gstMode) =>
            run(() =>
              !hasRoomCharge && reservationId
                ? setRoomRate({ reservationId, newRatePaise: toPaise(rate), gstMode })
                : correctRoomRate({ folioId: folio.id, newUnitPaise: toPaise(rate), gstMode, reason: "room rate correction" }),
            )
          }
          onCancel={() => setMode("none")}
        />
      )}
      {mode === "invoice" && (
        <BillToForm
          defaultName={lastBill?.customerName ?? guestName}
          defaultGstin={lastBill?.customerGstin ?? ""}
          pending={pending}
          onSubmit={generate}
          onCancel={() => setMode("none")}
        />
      )}
      {mode === "charge" && <ChargeForm pending={pending} onSubmit={(type, desc, unitPaise) => run(() => postFolioCharge({ folioId: folio.id, type, description: desc, unitPaise }))} onCancel={() => setMode("none")} />}
      {mode === "discount" && <DiscountForm pending={pending} onSubmit={(reason, rupeeAmt) => run(() => applyDiscount({ folioId: folio.id, reason, amountPaise: toPaise(rupeeAmt), mode: "FINANCIAL" }))} onCancel={() => setMode("none")} />}
      {mode === "addon" && reservationId && <AddOnForm addOns={addOns} pending={pending} onSubmit={(addOnId, qty) => run(() => addAddOnToReservation({ reservationId, addOnId, quantity: qty }))} onCancel={() => setMode("none")} />}
      {mode === "pay" && <PaymentForm balancePaise={folio.balancePaise} pending={pending} onSubmit={(tenders) => run(() => recordPayment({ folioId: folio.id, tenders, expectedTotalPaise: tenders.reduce((s, t) => s + t.amountPaise, 0) }))} onCancel={() => setMode("none")} />}

      {mode === "none" && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button size="lg" variant="outline" onClick={() => setMode("charge")} data-testid="add-charge">+ Charge</Button>
          {(hasRoomCharge || reservationId) && (
            <Button size="lg" variant="outline" onClick={() => setMode("roomrate")} data-testid="fix-room-rate">{hasRoomCharge ? "Fix room rate" : "Set room rate"}</Button>
          )}
          {reservationId && addOns.length > 0 && (
            <Button size="lg" variant="outline" onClick={() => setMode("addon")} data-testid="add-addon">+ Add-on</Button>
          )}
          <Button size="lg" variant="outline" onClick={() => setMode("discount")} data-testid="apply-discount">− Discount</Button>
          <Button size="lg" onClick={() => setMode("pay")} data-testid="take-payment">Take payment</Button>
          {/* One live invoice per bill: once issued, corrections go through Void & revise. */}
          <Button size="lg" variant="outline" disabled={pending || folio.lines.length === 0 || !!activeInvoice} title={activeInvoice ? `Invoice ${activeInvoice.number} is already issued — use Void & revise to correct it` : undefined} onClick={() => setMode("invoice")} data-testid="generate-invoice">Generate GST invoice</Button>
        </div>
      )}
        </div>
      </div>
    </div>
  );
}

function RoomRateForm({ onSubmit, onCancel, pending, hasRoomCharge }: { onSubmit: (ratePerNight: number, gstMode: "inclusive" | "exclusive") => void; onCancel: () => void; pending: boolean; hasRoomCharge: boolean }) {
  const [rate, setRate] = useState(0);
  const [gstMode, setGstMode] = useState<"inclusive" | "exclusive">("exclusive");
  return (
    <Card><CardContent className="space-y-3 p-4">
      <p className="text-sm text-muted-foreground">
        {hasRoomCharge ? (
          <>Wrong room rate picked (e.g. an OTA / Booking.com booking)? Enter the <span className="font-medium">correct rate per night</span> and choose whether GST (5%) is already included or added on top — the current room charges are cancelled and re-posted at this rate for the same number of nights. Works even after checkout; re-generate the invoice afterwards.</>
        ) : (
          <>This bill has <span className="font-medium">no room charge</span> (e.g. an online/OTA booking saved without a rate). Enter the <span className="font-medium">rate per night</span> and choose GST included or on top — every stayed night is added to the bill and, for a checked-out stay, the GST invoice is raised. Then record the OTA&apos;s money with Take payment → &quot;Online / OTA prepaid&quot;.</>
        )}
      </p>
      <Input type="number" inputMode="decimal" step="0.01" placeholder="Correct rate per night ₹" value={rate || ""} onChange={(e) => setRate(Number(e.target.value))} data-testid="roomrate-amount" />
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name="roomrate-gst" checked={gstMode === "exclusive"} onChange={() => setGstMode("exclusive")} data-testid="roomrate-exclusive" />
          Add GST on top
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="roomrate-gst" checked={gstMode === "inclusive"} onChange={() => setGstMode("inclusive")} data-testid="roomrate-inclusive" />
          Rate includes GST
        </label>
      </div>
      <div className="flex gap-2">
        <Button size="lg" disabled={pending || rate <= 0} onClick={() => onSubmit(rate, gstMode)} data-testid="roomrate-submit">Apply correct rate</Button>
        <Button size="lg" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </CardContent></Card>
  );
}

function ChargeForm({ onSubmit, onCancel, pending }: { onSubmit: (type: string, desc: string, unitPaise: number) => void; onCancel: () => void; pending: boolean }) {
  const [type, setType] = useState("FOOD");
  const [desc, setDesc] = useState("");
  const [amt, setAmt] = useState(0);
  const [gstInclusive, setGstInclusive] = useState(false);
  // GST on food / laundry / taxi / etc. — let staff say whether the amount they type
  // already INCLUDES GST (back out the taxable) or GST is added ON TOP. Matches the
  // room-rate toggle so every charge is consistent.
  const enteredPaise = toPaise(amt);
  const bps = gstBpsForCharge(type as never, type === "ROOM" ? enteredPaise : undefined);
  const taxablePaise = gstInclusive ? Math.round((enteredPaise * 10_000) / (10_000 + bps)) : enteredPaise;
  const gstPaise = Math.round((taxablePaise * bps) / 10_000);
  return (
    <Card><CardContent className="space-y-3 p-4">
      <select value={type} onChange={(e) => setType(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="charge-type">
        {["ROOM", "FOOD", "LAUNDRY", "AIRPORT_TRANSFER", "TAXI", "EXTRA_BED", "MISC"].map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <Input placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} data-testid="charge-desc" />
      <Input type="number" inputMode="decimal" step="0.01" placeholder="Amount ₹" value={amt} onChange={(e) => setAmt(Number(e.target.value))} data-testid="charge-amount" />
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="radio" name="chargeGst" checked={!gstInclusive} onChange={() => setGstInclusive(false)} data-testid="charge-gst-exclusive" /> Add GST on top</label>
        <label className="flex items-center gap-2"><input type="radio" name="chargeGst" checked={gstInclusive} onChange={() => setGstInclusive(true)} data-testid="charge-gst-inclusive" /> Price includes GST</label>
      </div>
      {amt > 0 ? (
        <p className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground" data-testid="charge-gst-preview">
          GST {bps / 100}%: taxable {rupees(taxablePaise)} + GST {rupees(gstPaise)} = <span className="font-medium text-foreground">{rupees(taxablePaise + gstPaise)}</span>
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button size="lg" disabled={pending || !desc || amt <= 0} onClick={() => onSubmit(type, desc, taxablePaise)} data-testid="charge-submit">Add</Button>
        <Button size="lg" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </CardContent></Card>
  );
}

function AddOnForm({ addOns, onSubmit, onCancel, pending }: { addOns: AddOnOption[]; onSubmit: (addOnId: string, qty: number) => void; onCancel: () => void; pending: boolean }) {
  const [addOnId, setAddOnId] = useState(addOns[0]?.id ?? "");
  const [qty, setQty] = useState(1);
  const selected = addOns.find((a) => a.id === addOnId);
  return (
    <Card><CardContent className="space-y-3 p-4">
      <p className="text-sm text-muted-foreground">Post a catalogue add-on (airport pickup, extra service…) straight to the folio — GST is applied from the item.</p>
      <select value={addOnId} onChange={(e) => setAddOnId(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="addon-select">
        {addOns.map((a) => <option key={a.id} value={a.id}>{a.name} — {rupees(a.pricePaise)}</option>)}
      </select>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Qty</span>
        <Input type="number" inputMode="numeric" min={1} max={50} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} className="w-24" data-testid="addon-qty" />
        {selected && <span className="text-sm">= {rupees(selected.pricePaise * qty)}</span>}
      </div>
      <div className="flex gap-2">
        <Button size="lg" disabled={pending || !addOnId} onClick={() => onSubmit(addOnId, qty)} data-testid="addon-submit">Add to folio</Button>
        <Button size="lg" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </CardContent></Card>
  );
}

function ReverseForm({ description, onSubmit, onCancel, pending }: { description: string; onSubmit: (reason: string) => void; onCancel: () => void; pending: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <Card className="border-destructive/40"><CardContent className="space-y-3 p-4">
      <p className="text-sm">Reverse <span className="font-medium">{description}</span>? A reversing entry is appended (the original line is never edited) and the balance recalculates.</p>
      <Input placeholder="Reason (e.g. wrong amount, duplicate)" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="reverse-reason" />
      <div className="flex gap-2">
        <Button size="lg" variant="destructive" disabled={pending || !reason} onClick={() => onSubmit(reason)} data-testid="reverse-submit">Reverse charge</Button>
        <Button size="lg" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </CardContent></Card>
  );
}

function VoidForm({ number, onSubmit, onCancel, pending }: { number: string; onSubmit: (reason: string) => void; onCancel: () => void; pending: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <Card className="border-destructive/40"><CardContent className="space-y-3 p-4">
      <p className="text-sm">
        Void invoice <span className="font-mono font-medium">{number}</span>? A <b>credit note</b> is issued on the same number series (the original is never deleted — GST rules). Afterwards, correct the charges and generate the revised bill.
      </p>
      <Input placeholder="Reason (e.g. wrong amount, guest dispute, rate revised)" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="void-reason" />
      <div className="flex gap-2">
        <Button size="lg" variant="destructive" disabled={pending || !reason} onClick={() => onSubmit(reason)} data-testid="void-submit">Void &amp; issue credit note</Button>
        <Button size="lg" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </CardContent></Card>
  );
}

function DiscountForm({ onSubmit, onCancel, pending }: { onSubmit: (reason: string, amt: number) => void; onCancel: () => void; pending: boolean }) {
  const [reason, setReason] = useState("");
  const [amt, setAmt] = useState(0);
  return (
    <Card><CardContent className="space-y-3 p-4">
      <p className="text-sm text-muted-foreground">Reduce the bill by exactly this amount — a ₹10 discount takes ₹10 off the total (no GST adjustment). Over the org threshold needs a manager&apos;s permission.</p>
      <Input placeholder="Reason (e.g. loyalty, corporate rate)" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="discount-reason" />
      <Input type="number" inputMode="decimal" step="0.01" placeholder="Discount ₹" value={amt} onChange={(e) => setAmt(Number(e.target.value))} data-testid="discount-amount" />
      <div className="flex gap-2">
        <Button size="lg" disabled={pending || !reason || amt <= 0} onClick={() => onSubmit(reason, amt)} data-testid="discount-submit">Apply discount</Button>
        <Button size="lg" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </CardContent></Card>
  );
}

function PaymentForm({ balancePaise, onSubmit, onCancel, pending }: { balancePaise: number; onSubmit: (t: Tender[]) => void; onCancel: () => void; pending: boolean }) {
  // No default mode: a pre-selected "UPI" was silently accepted for cash/card
  // payments and recorded the wrong mode. Staff enter the amount, then must pick
  // the mode explicitly — Confirm stays disabled until every tender has one.
  const [tenders, setTenders] = useState<Tender[]>([{ mode: "", amountPaise: balancePaise }]);
  const total = tenders.reduce((s, t) => s + t.amountPaise, 0);
  const remaining = balancePaise - total;
  const missingMode = tenders.some((t) => t.amountPaise > 0 && !t.mode);
  return (
    <Card><CardContent className="space-y-3 p-4">
      {/* Stacked, each full-width: the actions rail is only ~1/3 of the page, so a
          side-by-side mode+amount squeezed the amount box and clipped large totals
          (e.g. ₹7,051.2 showed as "705"). Amount first, then the mode. */}
      {tenders.map((t, i) => (
        <div key={i} className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor={`tender-amount-${i}`} className="text-xs text-muted-foreground">Amount (₹)</Label>
            <Input id={`tender-amount-${i}`} type="number" inputMode="decimal" step="0.01" min={0} placeholder="e.g. 2500" value={t.amountPaise ? t.amountPaise / 100 : ""} onChange={(e) => setTenders((ts) => ts.map((x, j) => (j === i ? { ...x, amountPaise: toPaise(Number(e.target.value)) } : x)))} className="w-full" data-testid={`tender-amount-${i}`} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`tender-mode-${i}`} className="text-xs text-muted-foreground">Payment mode <span className="text-destructive">*</span></Label>
            <select id={`tender-mode-${i}`} value={t.mode} onChange={(e) => setTenders((ts) => ts.map((x, j) => (j === i ? { ...x, mode: e.target.value } : x)))} className={`h-10 w-full rounded-md border bg-background px-2 text-sm ${t.amountPaise > 0 && !t.mode ? "border-amber-500" : "border-input"}`} data-testid={`tender-mode-${i}`}>
              <option value="" disabled>Select payment mode…</option>
              {["CASH", "UPI", "CREDIT_CARD", "DEBIT_CARD", "BANK_TRANSFER", "ONLINE"].map((m) => <option key={m} value={m}>{m === "ONLINE" ? "Online / OTA prepaid (MMT, Booking.com)" : m.replace(/_/g, " ")}</option>)}
            </select>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between text-sm">
        <span>
          {remaining > 0
            ? <>Partial — <span data-testid="remaining">{rupees(remaining)}</span> will remain due</>
            : remaining < 0
              // Over-collection warning: taking MORE than the balance due is almost
              // always an advance already applied / the gross total keyed by mistake
              // instead of the (pre-filled) balance. Loud amber so it isn't waved
              // through — but not blocked, since a genuine pre-stay deposit (balance
              // already ≤ 0) is legitimate and stays the quiet "credit" phrasing.
              ? (balancePaise > 0
                  ? <span className="font-medium text-amber-600">⚠ <span data-testid="remaining">{rupees(-remaining)}</span> more than the balance due — the guest will be owed this back</span>
                  : <>Advance — <span data-testid="remaining">{rupees(-remaining)}</span> credit</>)
              : <>Settles in full (<span data-testid="remaining">{rupees(0)}</span> due)</>}
        </span>
        <Button variant="ghost" size="sm" onClick={() => setTenders((ts) => [...ts, { mode: "", amountPaise: Math.max(0, remaining) }])}>+ tender</Button>
      </div>
      {missingMode && (
        <p className="text-sm font-medium text-amber-600" data-testid="tender-mode-missing">Select the payment mode (Cash / UPI / Card…) to confirm.</p>
      )}
      <div className="flex gap-2">
        {/* Partial payments / deposits are allowed — any positive amount; the balance
            simply updates. (Previously this forced an exact full settlement.) */}
        <Button size="lg" disabled={pending || total <= 0 || missingMode} onClick={() => onSubmit(tenders.filter((t) => t.amountPaise > 0))} data-testid="confirm-payment">Confirm</Button>
        <Button size="lg" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </CardContent></Card>
  );
}
