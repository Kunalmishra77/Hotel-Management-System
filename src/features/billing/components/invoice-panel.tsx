"use client";

/**
 * Bills on a folio — pick any invoice to see who it was billed to and its tax
 * breakup, open / download its PDF, or void & revise it; and the "Bill to" form
 * used when issuing (or re-issuing) a GST invoice, so the name and GSTIN can be
 * corrected on the revised bill (client: "pick any invoice, edit and re-issue").
 *
 * A tax invoice is never edited in place (GST): voiding issues a credit note on
 * the same series, then a new invoice is generated with the corrected details.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { FolioInvoiceView } from "../queries";

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: Date | string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
/** 15-character GSTIN: 2-digit state, PAN, entity, Z, checksum. */
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function InvoiceHistory({
  invoices,
  pending,
  canVoid,
  onVoid,
}: {
  invoices: FolioInvoiceView[];
  pending: boolean;
  canVoid: boolean;
  onVoid: (inv: { id: string; number: string }) => void;
}) {
  const voidedIds = new Set(invoices.filter((i) => i.cancelsInvoiceId).map((i) => i.cancelsInvoiceId!));
  const numberOf = new Map(invoices.map((i) => [i.id, i.number]));
  const creditFor = new Map(invoices.filter((i) => i.cancelsInvoiceId).map((i) => [i.cancelsInvoiceId!, i.number]));
  const current = invoices.filter((i) => i.type === "TAX_INVOICE" && !voidedIds.has(i.id));
  const trail = invoices.filter((i) => voidedIds.has(i.id) || i.type === "CREDIT_NOTE");
  const [selected, setSelected] = useState<string | null>(current.length === 1 ? current[0]!.id : null);

  const row = (inv: FolioInvoiceView) => {
    const isCredit = inv.type === "CREDIT_NOTE";
    const voided = voidedIds.has(inv.id);
    const live = !isCredit && !voided;
    const open = selected === inv.id;
    const label = isCredit
      ? `Credit note · cancels ${inv.cancelsInvoiceId ? (numberOf.get(inv.cancelsInvoiceId) ?? "a bill") : "a bill"}`
      : voided
        ? `Tax invoice · VOIDED by ${creditFor.get(inv.id) ?? "credit note"}`
        : "Tax invoice";
    return (
      <li key={inv.id} className={cn("rounded-md border", open && "border-primary")}>
        <button
          type="button"
          onClick={() => setSelected(open ? null : inv.id)}
          aria-expanded={open}
          className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left"
          data-testid={`invoice-row-${inv.number}`}
        >
          <span className="flex flex-col">
            <span className="font-mono font-medium">{inv.number}</span>
            <span className="text-xs text-muted-foreground">{label} · {day(inv.issuedAt)}</span>
          </span>
          <span className={cn("tabular", !live && "text-muted-foreground line-through")}>{rupees(inv.totalPaise)}</span>
        </button>
        {open && (
          <div className="space-y-2 border-t px-3 py-2 text-sm" data-testid="invoice-detail">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Billed to</dt><dd>{inv.customerName}</dd>
              <dt className="text-muted-foreground">GSTIN</dt><dd className="font-mono">{inv.customerGstin || "— (B2C)"}</dd>
              <dt className="text-muted-foreground">Taxable value</dt><dd className="tabular">{rupees(inv.taxableValuePaise)}</dd>
              <dt className="text-muted-foreground">CGST + SGST</dt><dd className="tabular">{rupees(inv.cgstPaise)} + {rupees(inv.sgstPaise)}</dd>
              {inv.igstPaise !== 0 && (<><dt className="text-muted-foreground">IGST</dt><dd className="tabular">{rupees(inv.igstPaise)}</dd></>)}
              <dt className="font-medium">Total</dt><dd className="tabular font-medium">{rupees(inv.totalPaise)}</dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <a href={`/api/invoices/${inv.id}`} target="_blank" rel="noopener noreferrer">View PDF</a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={`/api/invoices/${inv.id}?download=1`} data-testid="invoice-download">Download</a>
              </Button>
              {live && canVoid && (
                <Button size="sm" disabled={pending} onClick={() => onVoid({ id: inv.id, number: inv.number })} data-testid="void-invoice">
                  Void &amp; revise
                </Button>
              )}
            </div>
            {live && canVoid && (
              <p className="text-xs text-muted-foreground">
                A tax invoice can&apos;t be edited (GST). Void &amp; revise issues a credit note against it; then correct the charges and press <b>Generate GST invoice</b> — you can change the name and GSTIN there.
              </p>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-2">
      {current.length > 1 && (
        <p className="rounded-md border border-warning/50 bg-warning/10 p-2 text-xs" data-testid="multiple-live-invoices">
          This bill has {current.length} live tax invoices for the same stay. Keep the correct one and void the others.
        </p>
      )}
      {current.length > 0 ? <ul className="space-y-2">{current.map(row)}</ul> : <p className="text-muted-foreground">No current bill yet — press Generate GST invoice.</p>}
      {trail.length > 0 && (
        <details className="rounded-md border bg-muted/20 p-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">Voided bills &amp; credit notes · {trail.length} — kept for GST records</summary>
          <ul className="mt-2 space-y-2">{trail.map(row)}</ul>
        </details>
      )}
    </div>
  );
}

export function BillToForm({
  defaultName,
  defaultGstin,
  pending,
  onSubmit,
  onCancel,
}: {
  defaultName: string;
  defaultGstin: string;
  pending: boolean;
  onSubmit: (name: string, gstin: string | undefined) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [gstin, setGstin] = useState(defaultGstin);
  const g = gstin.trim().toUpperCase();
  const gstinBad = g !== "" && !GSTIN_RE.test(g);
  return (
    <form
      className="space-y-3 rounded-md border p-3"
      onSubmit={(e) => { e.preventDefault(); if (!name.trim() || gstinBad) return; onSubmit(name.trim(), g || undefined); }}
      data-testid="bill-to-form"
    >
      <p className="text-sm font-medium">Bill to</p>
      <div className="space-y-1.5">
        <Label htmlFor="bill-to-name">Name on the invoice</Label>
        <Input id="bill-to-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Guest or company name" data-testid="bill-to-name" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="bill-to-gstin">Customer GSTIN (company bills only)</Label>
        <Input id="bill-to-gstin" value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder="e.g. 07AAHCT9474D1Z0" autoCapitalize="characters" data-testid="bill-to-gstin" />
        {gstinBad && <p role="alert" className="text-xs text-destructive">A GSTIN is 15 characters, e.g. 07AAHCT9474D1Z0.</p>}
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !name.trim() || gstinBad} data-testid="bill-to-submit">Issue GST invoice</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
