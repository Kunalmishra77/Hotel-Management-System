"use client";

/**
 * Bills on a folio — pick any invoice to see who it was billed to and its tax
 * breakup, open / download its PDF, correct it or cancel it; and the "Bill to"
 * form used when issuing or correcting a GST invoice.
 *
 * One bill, one number (client, 22 Nov 2026 — specs/06 FR-RV-1): "Correct bill"
 * re-issues the SAME number as the next revision (the old one is kept, superseded).
 * "Cancel bill" (credit note) is only for a stay that was cancelled or refunded.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { FolioInvoiceView } from "../queries";
import { billPartLabel, isGuestBill } from "../domain/bill-parts";
import { BillToFields, billToPayload, billToProblem, emptyBillTo, rememberCompany, type BillToValue } from "./bill-to-fields";

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: Date | string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export function InvoiceHistory({
  invoices,
  pending,
  canVoid,
  onVoid,
  onCorrect,
}: {
  invoices: FolioInvoiceView[];
  pending: boolean;
  canVoid: boolean;
  onVoid: (inv: { id: string; number: string }) => void;
  onCorrect: (inv: FolioInvoiceView) => void;
}) {
  const voidedIds = new Set(invoices.filter((i) => i.cancelsInvoiceId).map((i) => i.cancelsInvoiceId!));
  const numberOf = new Map(invoices.map((i) => [i.id, i.number]));
  const creditFor = new Map(invoices.filter((i) => i.cancelsInvoiceId).map((i) => [i.cancelsInvoiceId!, i.number]));
  const current = invoices.filter((i) => i.type === "TAX_INVOICE" && !voidedIds.has(i.id));
  const trail = invoices.filter((i) => voidedIds.has(i.id) || i.type === "CREDIT_NOTE");
  const [selected, setSelected] = useState<string | null>(current.length === 1 ? current[0]!.id : null);
  // Separate bills of one stay (OTA copy + Direct bill) are normal; two live bills
  // for the SAME part (or a whole-stay bill beside a part bill) are not.
  const partKeys = current.map((i) => i.billPart ?? "WHOLE");
  const dupParts = partKeys.some((k, i) => partKeys.indexOf(k) !== i) || (partKeys.includes("WHOLE") && partKeys.length > 1)
    ? [...new Set(partKeys)].map((k) => (k === "WHOLE" ? "whole stay" : billPartLabel(k))).join(", ") : null;

  const row = (inv: FolioInvoiceView) => {
    const isCredit = inv.type === "CREDIT_NOTE";
    const voided = voidedIds.has(inv.id);
    const live = !isCredit && !voided;
    const open = selected === inv.id;
    // Which bill of a split stay this is (older invoices cover the whole stay).
    const partTag = inv.billPart && inv.billPart !== "DIRECT" ? `${billPartLabel(inv.billPart)} bill (hotel copy) · ` : inv.billPart === "DIRECT" ? "Direct bill · " : "";
    const label = partTag + (isCredit
      ? `Credit note · cancels ${inv.cancelsInvoiceId ? (numberOf.get(inv.cancelsInvoiceId) ?? "a bill") : "a bill"}`
      : voided
        ? `Tax invoice · VOIDED by ${creditFor.get(inv.id) ?? "credit note"}`
        : "Tax invoice") + (inv.revision > 0 ? ` · corrected${inv.revision > 1 ? ` ×${inv.revision}` : ""}` : "");
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
            {!isGuestBill(inv.billPart) && (
              <p className="text-xs text-muted-foreground">This is the online booking&apos;s bill — kept by the hotel, not given to the guest.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <a href={`/api/invoices/${inv.id}`} target="_blank" rel="noopener noreferrer">View PDF</a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={`/api/invoices/${inv.id}?download=1`} data-testid="invoice-download">Download</a>
              </Button>
              {live && canVoid && (
                <Button size="sm" disabled={pending} onClick={() => onCorrect(inv)} data-testid="correct-invoice">
                  Correct bill
                </Button>
              )}
              {live && canVoid && (
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => onVoid({ id: inv.id, number: inv.number })} data-testid="void-invoice">
                  Cancel bill (credit note)
                </Button>
              )}
            </div>
            {live && canVoid && (
              <p className="text-xs text-muted-foreground">
                <b>Correct bill</b> re-issues this bill with the <b>same number</b> from the current charges (change the name, GSTIN or address there). <b>Cancel bill</b> is only for a stay that was cancelled or refunded.
              </p>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-2">
      {dupParts && (
        <p className="rounded-md border border-warning/50 bg-warning/10 p-2 text-xs" data-testid="multiple-live-invoices">
          This stay has two live bills for the same part ({dupParts}). Keep the correct one and cancel the other.
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

export type BillToSubmit = ReturnType<typeof billToPayload> & { seq?: number; reason?: string };

/**
 * Issue a bill (mode "generate": the number may be typed — blank = next free
 * number) or correct one (mode "correct": the number stays the same, a reason is
 * required). FR-RV-1/3.
 */
export function BillToForm({
  initial,
  mode = "generate",
  number,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: BillToValue;
  mode?: "generate" | "correct";
  number?: string;
  pending: boolean;
  onSubmit: (v: BillToSubmit) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<BillToValue>(initial);
  const [seq, setSeq] = useState("");
  const [reason, setReason] = useState("");
  const problem = billToProblem(value) ?? (mode === "correct" && !reason.trim() ? "Say what is being corrected." : null);
  const seqBad = seq.trim() !== "" && !/^\d{1,7}$/.test(seq.trim());
  return (
    <form
      className="space-y-3 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (problem || seqBad) return;
        rememberCompany(value);
        onSubmit({ ...billToPayload(value), ...(seq.trim() ? { seq: Number(seq.trim()) } : {}), ...(mode === "correct" ? { reason: reason.trim() } : {}) });
      }}
      data-testid="bill-to-form"
    >
      <p className="text-sm font-medium">{mode === "correct" ? `Correct bill ${number ?? ""}` : "Bill to"}</p>
      {mode === "correct" ? (
        <p className="text-xs text-muted-foreground">The bill keeps its number and date — it is re-issued from the folio&apos;s current charges with the details below. The earlier version stays in history.</p>
      ) : null}
      <BillToFields value={value} onChange={setValue} />
      {mode === "generate" ? (
        <div className="space-y-1.5">
          <Label htmlFor="bill-to-seq">Bill number (optional)</Label>
          <Input id="bill-to-seq" inputMode="numeric" value={seq} onChange={(e) => setSeq(e.target.value)} placeholder="Blank = next number" className="w-44" data-testid="bill-to-seq" />
          {seqBad ? <p role="alert" className="text-xs text-destructive">Type only the number, e.g. 853.</p> : null}
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="bill-to-reason">What is being corrected?</Label>
          <Input id="bill-to-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. company name and GSTIN added" data-testid="bill-to-reason" />
        </div>
      )}
      {problem && value.customerName.trim() ? <p className="text-xs text-muted-foreground">{problem}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !!problem || seqBad} data-testid="bill-to-submit">{mode === "correct" ? "Re-issue bill" : "Issue GST invoice"}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

/** A folio invoice's bill-to as the form's starting value. */
export function billToFromInvoice(inv: FolioInvoiceView | null, fallbackName: string): BillToValue {
  if (!inv) return emptyBillTo(fallbackName);
  return {
    customerName: inv.customerName, customerGstin: inv.customerGstin ?? "", customerAddress: inv.customerAddress ?? "",
    customerState: inv.customerState ?? "", customerPhone: inv.customerPhone ?? "", guestName: inv.guestName ?? "",
    company: !!(inv.customerGstin || inv.customerAddress),
  };
}
