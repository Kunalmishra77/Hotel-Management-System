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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { postFolioCharge, applyDiscount, reverseFolioLine, correctRoomRate } from "../charge-actions";
import { recordPayment } from "../payment-actions";
import { generateInvoice, voidInvoice } from "../invoice-actions";
import { addAddOnToReservation } from "@/features/add-ons/actions";
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
  const [mode, setMode] = useState<"none" | "charge" | "pay" | "discount" | "addon" | "roomrate">("none");
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

  const generate = () => {
    setError(null);
    start(async () => {
      const res = await generateInvoice({ folioId: folio.id, customerName: guestName });
      if (res.ok) { setInvoice({ id: res.data.invoiceId, number: res.data.number }); router.refresh(); }
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
            {(() => {
              const rowOf = (inv: typeof folio.invoices[number]) => {
                const isCredit = inv.type === "CREDIT_NOTE";
                const voided = voidedIds.has(inv.id);
                return (
                  <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0">
                    <span className="flex items-center gap-2">
                      <span className="font-mono font-medium">{inv.number}</span>
                      <span className="text-xs text-muted-foreground">
                        {isCredit ? "Credit note (voids a bill)" : voided ? "Tax invoice · VOIDED" : "Tax invoice"}
                        {" · "}{new Date(inv.issuedAt).toLocaleDateString("en-IN")}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className={`tabular ${voided || isCredit ? "text-muted-foreground line-through" : ""}`}>{rupees(inv.totalPaise)}</span>
                      <a href={`/api/invoices/${inv.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline underline-offset-2">PDF</a>
                    </span>
                  </div>
                );
              };
              // Show only the CURRENT bill(s). Voided invoices + their credit notes are
              // tucked into a collapsed "Voided (history)" block — they can't be deleted
              // (GST: issued invoices are permanent + gap-free), but they stay out of the way.
              const current = folio.invoices.filter((i) => i.type === "TAX_INVOICE" && !voidedIds.has(i.id));
              const trail = folio.invoices.filter((i) => voidedIds.has(i.id) || i.type === "CREDIT_NOTE");
              return (
                <>
                  {current.length > 0 ? current.map(rowOf) : <p className="text-muted-foreground">No current bill yet — press Generate GST invoice.</p>}
                  {trail.length > 0 && (
                    <details className="mt-1 rounded-md border bg-muted/20 p-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground">Voided bills (history) · {trail.length} — kept for GST records</summary>
                      <div className="mt-2 space-y-2">{trail.map(rowOf)}</div>
                    </details>
                  )}
                </>
              );
            })()}
            {invoiceStale && activeInvoice && (
              <div className="mt-1 rounded-md border border-warning/50 bg-warning/10 p-2.5 text-sm" data-testid="invoice-stale">
                <p className="font-medium text-warning">⚠ Bill {activeInvoice.number} is out of date</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  It was issued for {rupees(activeInvoice.totalPaise)}, but the folio now totals {rupees(folioChargeTotalPaise)} — newer charges (e.g. food) aren&apos;t on it. <b>Void &amp; revise</b>, then <b>Generate GST invoice</b> to issue one bill with everything.
                </p>
              </div>
            )}
            {activeInvoice && (
              <div className="pt-1">
                <Button size="sm" variant={invoiceStale ? "default" : "outline"} disabled={pending} onClick={() => setVoidTarget({ id: activeInvoice.id, number: activeInvoice.number })} data-testid="void-invoice">
                  Void &amp; revise this bill
                </Button>
                <p className="mt-1 text-xs text-muted-foreground">
                  Issues a credit note against <span className="font-mono">{activeInvoice.number}</span> (the law forbids editing a tax invoice). Then correct the charges above and press <b>Generate GST invoice</b> for the revised bill — the full chain stays on record here.
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
      {mode === "roomrate" && <RoomRateForm pending={pending} onSubmit={(rate) => run(() => correctRoomRate({ folioId: folio.id, newUnitPaise: toPaise(rate), reason: "room rate correction" }))} onCancel={() => setMode("none")} />}
      {mode === "charge" && <ChargeForm pending={pending} onSubmit={(type, desc, unitPaise) => run(() => postFolioCharge({ folioId: folio.id, type, description: desc, unitPaise }))} onCancel={() => setMode("none")} />}
      {mode === "discount" && <DiscountForm pending={pending} onSubmit={(reason, rupeeAmt) => run(() => applyDiscount({ folioId: folio.id, reason, amountPaise: toPaise(rupeeAmt) }))} onCancel={() => setMode("none")} />}
      {mode === "addon" && reservationId && <AddOnForm addOns={addOns} pending={pending} onSubmit={(addOnId, qty) => run(() => addAddOnToReservation({ reservationId, addOnId, quantity: qty }))} onCancel={() => setMode("none")} />}
      {mode === "pay" && <PaymentForm balancePaise={folio.balancePaise} pending={pending} onSubmit={(tenders) => run(() => recordPayment({ folioId: folio.id, tenders, expectedTotalPaise: tenders.reduce((s, t) => s + t.amountPaise, 0) }))} onCancel={() => setMode("none")} />}

      {mode === "none" && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button size="lg" variant="outline" onClick={() => setMode("charge")} data-testid="add-charge">+ Charge</Button>
          {hasRoomCharge && (
            <Button size="lg" variant="outline" onClick={() => setMode("roomrate")} data-testid="fix-room-rate">Fix room rate</Button>
          )}
          {reservationId && addOns.length > 0 && (
            <Button size="lg" variant="outline" onClick={() => setMode("addon")} data-testid="add-addon">+ Add-on</Button>
          )}
          <Button size="lg" variant="outline" onClick={() => setMode("discount")} data-testid="apply-discount">− Discount</Button>
          <Button size="lg" onClick={() => setMode("pay")} data-testid="take-payment">Take payment</Button>
          <Button size="lg" variant="outline" disabled={pending || folio.lines.length === 0} onClick={generate} data-testid="generate-invoice">Generate GST invoice</Button>
        </div>
      )}
        </div>
      </div>
    </div>
  );
}

function RoomRateForm({ onSubmit, onCancel, pending }: { onSubmit: (ratePerNight: number) => void; onCancel: () => void; pending: boolean }) {
  const [rate, setRate] = useState(0);
  return (
    <Card><CardContent className="space-y-3 p-4">
      <p className="text-sm text-muted-foreground">
        Wrong room rate picked (e.g. an OTA / Booking.com booking)? Enter the <span className="font-medium">correct rate per night</span> — the current room charges are cancelled and re-posted at this rate for the same number of nights. GST (5%) is applied automatically. Works even after checkout; re-generate the invoice afterwards.
      </p>
      <Input type="number" inputMode="decimal" step="0.01" placeholder="Correct rate per night ₹" value={rate} onChange={(e) => setRate(Number(e.target.value))} data-testid="roomrate-amount" />
      <div className="flex gap-2">
        <Button size="lg" disabled={pending || rate <= 0} onClick={() => onSubmit(rate)} data-testid="roomrate-submit">Apply correct rate</Button>
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
      <p className="text-sm text-muted-foreground">Reduce the bill — a discount posts as a negative line and the balance recalculates. Over the org threshold needs a manager&apos;s permission.</p>
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
  const [tenders, setTenders] = useState<Tender[]>([{ mode: "UPI", amountPaise: balancePaise }]);
  const total = tenders.reduce((s, t) => s + t.amountPaise, 0);
  const remaining = balancePaise - total;
  return (
    <Card><CardContent className="space-y-3 p-4">
      {tenders.map((t, i) => (
        <div key={i} className="flex gap-2">
          <select value={t.mode} onChange={(e) => setTenders((ts) => ts.map((x, j) => (j === i ? { ...x, mode: e.target.value } : x)))} className="h-10 rounded-md border border-input bg-background px-2 text-sm" data-testid={`tender-mode-${i}`}>
            {["UPI", "CASH", "CREDIT_CARD", "DEBIT_CARD", "BANK_TRANSFER"].map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
          </select>
          <Input type="number" inputMode="decimal" step="0.01" value={t.amountPaise / 100} onChange={(e) => setTenders((ts) => ts.map((x, j) => (j === i ? { ...x, amountPaise: toPaise(Number(e.target.value)) } : x)))} data-testid={`tender-amount-${i}`} />
        </div>
      ))}
      <div className="flex items-center justify-between text-sm">
        <span>
          {remaining > 0
            ? <>Partial — <span data-testid="remaining">{rupees(remaining)}</span> will remain due</>
            : remaining < 0
              ? <>Advance — <span data-testid="remaining">{rupees(-remaining)}</span> credit</>
              : <>Settles in full (<span data-testid="remaining">{rupees(0)}</span> due)</>}
        </span>
        <Button variant="ghost" size="sm" onClick={() => setTenders((ts) => [...ts, { mode: "CASH", amountPaise: Math.max(0, remaining) }])}>+ tender</Button>
      </div>
      <div className="flex gap-2">
        {/* Partial payments / deposits are allowed — any positive amount; the balance
            simply updates. (Previously this forced an exact full settlement.) */}
        <Button size="lg" disabled={pending || total <= 0} onClick={() => onSubmit(tenders)} data-testid="confirm-payment">Confirm</Button>
        <Button size="lg" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </CardContent></Card>
  );
}
