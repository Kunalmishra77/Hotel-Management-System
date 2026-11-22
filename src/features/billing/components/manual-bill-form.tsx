"use client";

/**
 * Manual bill form — specs/06 FR-MB-1. Create a GST bill for a customer who did
 * not stay (or correct one: same number, next revision). Staff fill everything:
 * hotel, date, customer, lines; the bill number is optional (blank = next).
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatINR } from "@/lib/utils";
import { manualBillTotal, manualLine, manualRoundOff } from "../domain/manual-bill";
import { createManualBill, correctManualBill } from "../manual-bill-actions";
import type { ManualBillDraft } from "../manual-bill-queries";
import { BillToFields, billToPayload, billToProblem, emptyBillTo, type BillToValue } from "./bill-to-fields";

/** Common lines with their SAC and usual GST rate — staff can change both. */
const PRESETS = [
  { label: "Room stay", sac: "996311", bps: 500 },
  { label: "Food & beverages", sac: "996331", bps: 500 },
  { label: "Laundry", sac: "999712", bps: 1800 },
  { label: "Transport / cab", sac: "996601", bps: 500 },
  { label: "Hall / event", sac: "997212", bps: 1800 },
  { label: "Other service", sac: "", bps: 1800 },
] as const;
const GST_OPTIONS = [0, 500, 1200, 1800, 2800];

type Line = { description: string; hsnSac: string; quantity: string; rate: string; gstBps: number; inclusive: boolean };
const blankLine = (): Line => ({ description: "", hsnSac: PRESETS[0].sac, quantity: "1", rate: "", gstBps: PRESETS[0].bps, inclusive: true });
const toPaise = (rupees: string) => Math.round(Number(rupees) * 100);
const PAID_MODES = [
  ["", "Not paid yet"], ["CASH", "Cash"], ["UPI", "UPI"], ["CREDIT_CARD", "Credit card"], ["DEBIT_CARD", "Debit card"], ["BANK_TRANSFER", "Bank transfer"], ["ONLINE", "Online"],
] as const;

export function ManualBillForm({
  properties, defaultPropertyId, today, draft,
}: {
  properties: { id: string; name: string }[];
  defaultPropertyId: string;
  today: string;
  draft?: ManualBillDraft | null;
}) {
  const correcting = !!draft;
  const [propertyId, setPropertyId] = useState(draft?.propertyId ?? defaultPropertyId);
  const [billDate, setBillDate] = useState(draft?.billDate ?? today);
  const [billTo, setBillTo] = useState<BillToValue>(draft ? {
    customerName: draft.customerName, customerGstin: draft.customerGstin ?? "", customerAddress: draft.customerAddress ?? "",
    customerState: draft.customerState ?? "", customerPhone: draft.customerPhone ?? "", guestName: draft.guestName ?? "",
    company: !!(draft.customerGstin || draft.customerAddress),
  } : emptyBillTo());
  const [lines, setLines] = useState<Line[]>(draft
    ? draft.lines.map((l) => ({ description: l.description, hsnSac: l.hsnSac, quantity: String(l.quantity), rate: (l.ratePaise / 100).toFixed(2), gstBps: l.gstBps, inclusive: false }))
    : [blankLine()]);
  const [seq, setSeq] = useState("");
  const [paidMode, setPaidMode] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ invoiceId: string; number: string; totalPaise: number } | null>(null);

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const parsed = lines.map((l) => ({
    description: l.description, hsnSac: l.hsnSac, quantity: Number(l.quantity), ratePaise: toPaise(l.rate), gstBps: l.gstBps, inclusive: l.inclusive,
  }));
  const lineOk = (p: (typeof parsed)[number]) => p.description.trim() !== "" && Number.isInteger(p.quantity) && p.quantity >= 1 && p.ratePaise > 0;
  // Live preview with the same domain maths the server uses (on-premise → CGST + SGST).
  const okLines = parsed.filter(lineOk);
  const computed = okLines.map((p) => manualLine(p, "same-state"));
  const total = {
    taxable: computed.reduce((n, l) => n + l.amountPaise, 0),
    tax: computed.reduce((n, l) => n + l.cgstPaise + l.sgstPaise, 0),
    total: manualBillTotal(computed) + manualRoundOff(okLines, computed),
  };

  const problem = billToProblem(billTo)
    ?? (parsed.some((p) => !lineOk(p)) ? "Every line needs a description, a quantity and a rate." : null)
    ?? (seq.trim() && !/^\d{1,7}$/.test(seq.trim()) ? "Bill number: type only the number, e.g. 853." : null)
    ?? (correcting && !reason.trim() ? "Say what is being corrected." : null);

  const submit = () => {
    if (problem) return;
    setError(null);
    start(async () => {
      const base = { billDate, ...billToPayload(billTo), lines: parsed.map((p) => ({ ...p, hsnSac: p.hsnSac || undefined })) };
      const res = draft
        ? await correctManualBill({ invoiceId: draft.invoiceId, ...base, reason: reason.trim() })
        : await createManualBill({ propertyId, ...base, ...(seq.trim() ? { seq: Number(seq.trim()) } : {}), ...(paidMode ? { paidMode } : {}) });
      if (res.ok) setDone(res.data);
      else setError(res.error.message);
    });
  };

  if (done) {
    return (
      <div className="space-y-3 rounded-xl border bg-card p-4" data-testid="manual-bill-done">
        <p className="text-base font-semibold">Bill {done.number} {correcting ? "corrected" : "created"} · {formatINR(done.totalPaise)}</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild><a href={`/api/invoices/${done.invoiceId}`} target="_blank" rel="noopener noreferrer">View PDF</a></Button>
          <Button asChild variant="outline"><a href={`/api/invoices/${done.invoiceId}?download=1`}>Download</a></Button>
          <Button asChild variant="outline"><Link href="/billing/manual">New manual bill</Link></Button>
          <Button asChild variant="ghost"><Link href="/billing#invoices">Back to Billing</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }} data-testid="manual-bill-form">
      <section className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="mb-property">Hotel</Label>
          <select id="mb-property" className="h-11 w-full rounded-md border bg-background px-3 text-sm" value={propertyId} disabled={correcting} onChange={(e) => setPropertyId(e.target.value)} data-testid="mb-property">
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mb-date">Bill date</Label>
          <Input id="mb-date" type="date" max={today} value={billDate} onChange={(e) => setBillDate(e.target.value)} data-testid="mb-date" />
        </div>
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Customer</h2>
        <BillToFields value={billTo} onChange={setBillTo} idPrefix="mb" />
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Items</h2>
        {lines.map((l, i) => (
          <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-12" data-testid={`mb-line-${i}`}>
            <div className="space-y-1 sm:col-span-4">
              <Label htmlFor={`mb-d-${i}`}>Description</Label>
              <Input id={`mb-d-${i}`} value={l.description} list="mb-presets" placeholder="e.g. Room stay 12–14 Nov" data-testid={`mb-desc-${i}`}
                onChange={(e) => {
                  const preset = PRESETS.find((p) => p.label === e.target.value);
                  setLine(i, { description: e.target.value, ...(preset ? { hsnSac: preset.sac, gstBps: preset.bps } : {}) });
                }} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor={`mb-s-${i}`}>SAC</Label>
              <Input id={`mb-s-${i}`} inputMode="numeric" value={l.hsnSac} onChange={(e) => setLine(i, { hsnSac: e.target.value })} />
            </div>
            <div className="space-y-1 sm:col-span-1">
              <Label htmlFor={`mb-q-${i}`}>Qty</Label>
              <Input id={`mb-q-${i}`} inputMode="numeric" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} data-testid={`mb-qty-${i}`} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor={`mb-r-${i}`}>Rate (₹)</Label>
              <Input id={`mb-r-${i}`} type="number" step="0.01" min="0" inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} data-testid={`mb-rate-${i}`} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor={`mb-g-${i}`}>GST</Label>
              <select id={`mb-g-${i}`} className="h-11 w-full rounded-md border bg-background px-2 text-sm" value={l.gstBps} onChange={(e) => setLine(i, { gstBps: Number(e.target.value) })}>
                {GST_OPTIONS.map((b) => <option key={b} value={b}>{b / 100}%</option>)}
              </select>
            </div>
            <div className="flex items-end justify-between gap-2 sm:col-span-1 sm:flex-col sm:items-stretch">
              <label className="flex min-h-11 items-center gap-1.5 text-xs">
                <input type="checkbox" className="size-4" checked={l.inclusive} onChange={(e) => setLine(i, { inclusive: e.target.checked })} /> incl. GST
              </label>
              {lines.length > 1 ? (
                <Button type="button" size="icon" variant="ghost" aria-label={`Remove item ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}><Trash2 className="size-4" /></Button>
              ) : null}
            </div>
          </div>
        ))}
        <datalist id="mb-presets">{PRESETS.map((p) => <option key={p.label} value={p.label} />)}</datalist>
        <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, blankLine()])}><Plus className="size-4" /> Add item</Button>
        <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-y-1 text-sm tabular-nums">
          <dt className="text-muted-foreground">Taxable value</dt><dd className="text-right">{formatINR(total.taxable)}</dd>
          <dt className="text-muted-foreground">CGST + SGST</dt><dd className="text-right">{formatINR(total.tax)}</dd>
          <dt className="font-semibold">Bill total</dt><dd className="text-right font-semibold" data-testid="mb-total">{formatINR(total.total)}</dd>
        </dl>
      </section>

      <section className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2">
        {correcting ? (
          <>
            <p className="text-sm sm:col-span-2">Bill number <span className="font-mono font-medium">{draft?.number}</span> stays the same — the earlier version is kept in history.</p>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="mb-reason">What is being corrected?</Label>
              <Input id="mb-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. rate changed, GSTIN added" data-testid="mb-reason" />
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="mb-seq">Bill number (optional)</Label>
              <Input id="mb-seq" inputMode="numeric" value={seq} onChange={(e) => setSeq(e.target.value)} placeholder="Blank = next number" data-testid="mb-seq" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mb-paid">Payment</Label>
              <select id="mb-paid" className="h-11 w-full rounded-md border bg-background px-3 text-sm" value={paidMode} onChange={(e) => setPaidMode(e.target.value)} data-testid="mb-paid">
                {PAID_MODES.map(([v, label]) => <option key={v} value={v}>{v ? `Paid in full · ${label}` : label}</option>)}
              </select>
            </div>
          </>
        )}
      </section>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {problem && billTo.customerName.trim() ? <p className="text-sm text-muted-foreground">{problem}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || !!problem} data-testid="mb-submit">{pending ? "Saving…" : correcting ? "Re-issue bill" : "Create bill"}</Button>
        <Button asChild type="button" variant="ghost"><Link href="/billing#invoices">Cancel</Link></Button>
      </div>
    </form>
  );
}
