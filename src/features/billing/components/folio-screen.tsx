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
import type { FolioView } from "../queries";

const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;
const toPaise = (r: number) => Math.round(r * 100);

type Tender = { mode: string; amountPaise: number };

export function FolioScreen({ folio, guestName }: { folio: FolioView; guestName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"none" | "charge" | "pay" | "discount">("none");
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null);

  const generate = () => {
    setError(null);
    start(async () => {
      const res = await generateInvoice({ folioId: folio.id, customerName: guestName });
      if (res.ok) { setInvoiceNumber(res.data.number); router.refresh(); }
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
      {invoiceNumber && <p className="rounded-md border bg-muted/40 p-3 text-sm" data-testid="invoice-number">Invoice generated: {invoiceNumber}</p>}

      {mode === "charge" && <ChargeForm pending={pending} onSubmit={(type, desc, rupeeAmt) => run(() => postFolioCharge({ folioId: folio.id, type, description: desc, unitPaise: toPaise(rupeeAmt) }))} onCancel={() => setMode("none")} />}
      {mode === "discount" && <DiscountForm pending={pending} onSubmit={(reason, rupeeAmt) => run(() => applyDiscount({ folioId: folio.id, reason, amountPaise: toPaise(rupeeAmt) }))} onCancel={() => setMode("none")} />}
      {mode === "pay" && <PaymentForm balancePaise={folio.balancePaise} pending={pending} onSubmit={(tenders) => run(() => recordPayment({ folioId: folio.id, tenders, expectedTotalPaise: tenders.reduce((s, t) => s + t.amountPaise, 0) }))} onCancel={() => setMode("none")} />}

      {mode === "none" && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button size="lg" variant="outline" onClick={() => setMode("charge")} data-testid="add-charge">+ Charge</Button>
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
