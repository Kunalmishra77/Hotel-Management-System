"use client";

/**
 * Separate bills on one stay (client, 10 Nov 2026). Shown when the folio splits
 * into more than one bill — typically an OTA booking (MakeMyTrip…) whose guest
 * extended directly or ordered food: the OTA's nights are the hotel's copy (never
 * handed to the guest), everything paid at the hotel is the Direct bill — the
 * only one the guest gets. Each bill has its own totals, balance and GST invoice.
 */
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { FolioInvoiceView, FolioView } from "../queries";

const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;

/** The live tax invoice covering a bill: its own, or an older whole-stay one. */
export function liveInvoiceFor(invoices: FolioInvoiceView[], part: string): FolioInvoiceView | null {
  const voided = new Set(invoices.filter((i) => i.cancelsInvoiceId).map((i) => i.cancelsInvoiceId));
  return [...invoices].reverse().find((i) => i.type === "TAX_INVOICE" && !voided.has(i.id) && (i.billPart === part || i.billPart === null)) ?? null;
}

export function BillPartsCard({
  folio,
  pending,
  onGenerate,
}: {
  folio: FolioView;
  pending: boolean;
  onGenerate: (part: string) => void;
}) {
  const parts = folio.parts.filter((p) => p.lineIds.length > 0);
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Separate bills on this stay</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm" data-testid="bill-parts">
        <p className="text-muted-foreground">
          The online booking&apos;s nights and what the guest pays at the hotel are billed separately. Only the <b>Direct</b> bill is given to the guest.
        </p>
        {parts.map((p) => {
          const inv = liveInvoiceFor(folio.invoices, p.part);
          const wholeStay = inv?.billPart === null;
          const stale = !!inv && !wholeStay && inv.totalPaise !== p.chargesPaise;
          return (
            <div key={p.part} className={cn("space-y-2 rounded-md border p-3", p.guestBill && "border-primary/50")} data-testid={`bill-part-${p.part}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">
                  {p.label} bill{" "}
                  <span className="text-xs font-normal text-muted-foreground">{p.guestBill ? "· given to the guest" : "· hotel copy, not given to the guest"}</span>
                </p>
                <p className="tabular text-xs text-muted-foreground">
                  {rupees(p.chargesPaise)} · paid {rupees(p.paidPaise)} · <span className={cn("font-medium", p.balancePaise !== 0 ? "text-foreground" : "")}>balance {rupees(p.balancePaise)}</span>
                </p>
              </div>
              {inv ? (
                <p className="flex flex-wrap items-center gap-2 text-xs">
                  <span>Invoice <span className="font-mono font-medium">{inv.number}</span>{wholeStay ? " (covers the whole stay — void & revise it to split the bills)" : ""}</span>
                  <a href={`/api/invoices/${inv.id}`} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">View PDF</a>
                </p>
              ) : (
                <Button size="sm" variant="outline" disabled={pending || p.chargesPaise === 0} onClick={() => onGenerate(p.part)} data-testid={`generate-invoice-${p.part}`}>
                  Generate {p.label} GST invoice
                </Button>
              )}
              {stale && (
                <p className="rounded-md border border-warning/50 bg-warning/10 p-2 text-xs" data-testid={`bill-part-stale-${p.part}`}>
                  ⚠ Invoice {inv!.number} was issued for {rupees(inv!.totalPaise)}; this bill now totals {rupees(p.chargesPaise)}. Void &amp; revise it, then generate it again.
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
