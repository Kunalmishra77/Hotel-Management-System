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
import { postFolioCharge, applyDiscount } from "../charge-actions";
import { recordPayment } from "../payment-actions";
import { generateInvoice } from "../invoice-actions";
import { addAddOnToReservation } from "@/features/add-ons/actions";
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
  const [mode, setMode] = useState<"none" | "charge" | "pay" | "discount" | "addon">("none");
  const [invoice, setInvoice] = useState<{ id: string; number: string } | null>(null);

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
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Folio · {guestName}</h1>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Charges & payments</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm" data-testid="folio-lines">
          {folio.lines.map((l) => (
            <Row key={l.id} label={`${l.type} · ${l.description}`} value={rupees(l.amountPaise + l.cgstPaise + l.sgstPaise + l.igstPaise)} />
          ))}
          {folio.payments.map((p) => (
            <Row key={p.id} label={`Payment · ${p.mode}${p.isRefund ? " (refund)" : ""}`} value={`${p.isRefund ? "+" : "−"} ${rupees(p.amountPaise)}`} />
          ))}
          <div className="mt-2 flex justify-between border-t pt-2 text-base font-semibold">
            <span>Balance due</span><span data-testid="folio-balance">{rupees(folio.balancePaise)}</span>
          </div>
        </CardContent>
      </Card>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {invoice && (
        <p className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm" data-testid="invoice-number">
          <span>Invoice generated: <span className="font-mono font-medium">{invoice.number}</span></span>
          <a href={`/api/invoices/${invoice.id}`} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-4">View PDF</a>
        </p>
      )}

      {mode === "charge" && <ChargeForm pending={pending} onSubmit={(type, desc, rupeeAmt) => run(() => postFolioCharge({ folioId: folio.id, type, description: desc, unitPaise: toPaise(rupeeAmt) }))} onCancel={() => setMode("none")} />}
      {mode === "discount" && <DiscountForm pending={pending} onSubmit={(reason, rupeeAmt) => run(() => applyDiscount({ folioId: folio.id, reason, amountPaise: toPaise(rupeeAmt) }))} onCancel={() => setMode("none")} />}
      {mode === "addon" && reservationId && <AddOnForm addOns={addOns} pending={pending} onSubmit={(addOnId, qty) => run(() => addAddOnToReservation({ reservationId, addOnId, quantity: qty }))} onCancel={() => setMode("none")} />}
      {mode === "pay" && <PaymentForm balancePaise={folio.balancePaise} pending={pending} onSubmit={(tenders) => run(() => recordPayment({ folioId: folio.id, tenders, expectedTotalPaise: tenders.reduce((s, t) => s + t.amountPaise, 0) }))} onCancel={() => setMode("none")} />}

      {mode === "none" && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button size="lg" variant="outline" onClick={() => setMode("charge")} data-testid="add-charge">+ Charge</Button>
          {reservationId && addOns.length > 0 && (
            <Button size="lg" variant="outline" onClick={() => setMode("addon")} data-testid="add-addon">+ Add-on</Button>
          )}
          <Button size="lg" variant="outline" onClick={() => setMode("discount")} data-testid="apply-discount">− Discount</Button>
          <Button size="lg" onClick={() => setMode("pay")} data-testid="take-payment" disabled={folio.balancePaise <= 0}>Take payment</Button>
          <Button size="lg" variant="outline" disabled={pending} onClick={generate} data-testid="generate-invoice">Generate GST invoice</Button>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between"><span className="text-muted-foreground">{label}</span><span>{value}</span></div>;
}

function ChargeForm({ onSubmit, onCancel, pending }: { onSubmit: (type: string, desc: string, amt: number) => void; onCancel: () => void; pending: boolean }) {
  const [type, setType] = useState("FOOD");
  const [desc, setDesc] = useState("");
  const [amt, setAmt] = useState(0);
  return (
    <Card><CardContent className="space-y-3 p-4">
      <select value={type} onChange={(e) => setType(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="charge-type">
        {["ROOM", "FOOD", "LAUNDRY", "AIRPORT_TRANSFER", "TAXI", "EXTRA_BED", "MISC"].map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <Input placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} data-testid="charge-desc" />
      <Input type="number" inputMode="numeric" placeholder="Amount ₹" value={amt} onChange={(e) => setAmt(Number(e.target.value))} data-testid="charge-amount" />
      <div className="flex gap-2">
        <Button size="lg" disabled={pending || !desc || amt <= 0} onClick={() => onSubmit(type, desc, amt)} data-testid="charge-submit">Add</Button>
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

function DiscountForm({ onSubmit, onCancel, pending }: { onSubmit: (reason: string, amt: number) => void; onCancel: () => void; pending: boolean }) {
  const [reason, setReason] = useState("");
  const [amt, setAmt] = useState(0);
  return (
    <Card><CardContent className="space-y-3 p-4">
      <p className="text-sm text-muted-foreground">Reduce the bill — a discount posts as a negative line and the balance recalculates. Over the org threshold needs a manager&apos;s permission.</p>
      <Input placeholder="Reason (e.g. loyalty, corporate rate)" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="discount-reason" />
      <Input type="number" inputMode="numeric" placeholder="Discount ₹" value={amt} onChange={(e) => setAmt(Number(e.target.value))} data-testid="discount-amount" />
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
            {["UPI", "CASH", "CREDIT_CARD", "DEBIT_CARD"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <Input type="number" inputMode="numeric" value={t.amountPaise / 100} onChange={(e) => setTenders((ts) => ts.map((x, j) => (j === i ? { ...x, amountPaise: toPaise(Number(e.target.value)) } : x)))} data-testid={`tender-amount-${i}`} />
        </div>
      ))}
      <div className="flex items-center justify-between text-sm">
        <span>Remaining: <span data-testid="remaining">{rupees(remaining)}</span></span>
        <Button variant="ghost" size="sm" onClick={() => setTenders((ts) => [...ts, { mode: "CASH", amountPaise: Math.max(0, remaining) }])}>+ tender</Button>
      </div>
      <div className="flex gap-2">
        <Button size="lg" disabled={pending || remaining !== 0} onClick={() => onSubmit(tenders)} data-testid="confirm-payment">Confirm</Button>
        <Button size="lg" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </CardContent></Card>
  );
}
