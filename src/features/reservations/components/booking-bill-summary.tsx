/**
 * Complete booking bill — the full financial picture on the booking-details page:
 * every folio line (room, food, extra bed, discount, tax…), payment history, and
 * the derived totals (taxable, GST, paid, balance). Read-only; the interactive
 * folio (add charge / take payment / invoice) is one tap away. All money comes
 * from the folio query — nothing is recomputed divergently.
 */
import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FolioView } from "@/features/billing/queries";
import { formatINR } from "@/lib/utils";

export function BookingBillSummary({
  folio,
  reservationId,
  canManageFolio,
}: {
  folio: FolioView;
  reservationId: string;
  canManageFolio: boolean;
}) {
  const taxable = folio.lines.reduce((s, l) => s + l.amountPaise, 0);
  const tax = folio.lines.reduce((s, l) => s + l.cgstPaise + l.sgstPaise + l.igstPaise, 0);
  const total = taxable + tax;
  const paid = folio.payments.reduce((s, p) => s + (p.isRefund ? -p.amountPaise : p.amountPaise), 0);

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary">
          <ReceiptText /> Bill
        </CardTitle>
        <Button asChild variant="outline" size="sm">
          <Link href={`/bookings/${reservationId}/folio`}>{canManageFolio ? "Manage folio" : "Open folio"}</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {/* Charges & discounts */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Charges</p>
          {folio.lines.length === 0 ? (
            <p className="text-muted-foreground">No charges posted yet.</p>
          ) : (
            <ul className="space-y-1">
              {folio.lines.map((l) => {
                const lineTotal = l.amountPaise + l.cgstPaise + l.sgstPaise + l.igstPaise;
                return (
                  <li key={l.id} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{l.type}</span>{" "}
                      <span className="text-muted-foreground">{l.description}</span>
                    </span>
                    <span className={`shrink-0 tabular ${l.amountPaise < 0 ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
                      {formatINR(lineTotal)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Payments */}
        {folio.payments.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payments</p>
            <ul className="space-y-1">
              {folio.payments.map((p) => (
                <li key={p.id} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{p.mode}{p.isRefund ? " (refund)" : ""}</span>
                  <span className="shrink-0 tabular">{p.isRefund ? "+" : "−"} {formatINR(p.amountPaise)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Totals */}
        <div className="space-y-1 border-t pt-3">
          <Row label="Taxable value" value={formatINR(taxable)} muted />
          <Row label="GST (CGST + SGST + IGST)" value={formatINR(tax)} muted />
          <Row label="Total" value={formatINR(total)} />
          <Row label="Paid" value={formatINR(paid)} muted />
          <div className="flex justify-between border-t pt-2 text-base font-semibold">
            <span>Balance due</span>
            <span className={`tabular ${folio.balancePaise > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}>
              {formatINR(folio.balancePaise)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className={muted ? "text-muted-foreground" : ""}>{label}</span>
      <span className={`tabular ${muted ? "text-muted-foreground" : "font-medium"}`}>{value}</span>
    </div>
  );
}
