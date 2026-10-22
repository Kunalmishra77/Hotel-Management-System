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

  // A reversed line + its REVERSAL cancel out — show only the NET active charges
  // (totals above already net them out). The guest's bill never shows reversals.
  // A sub-rupee "Round off" MISC line is a rounding adjustment, not a real charge, so
  // it's kept out of the itemised list (it's still in the totals) — the bill reads as
  // plain "what was charged for what".
  const reversedIds = new Set(folio.lines.filter((l) => l.reversalOfId).map((l) => l.reversalOfId));
  const activeLines = folio.lines.filter(
    (l) => l.type !== "REVERSAL" && !reversedIds.has(l.id) && !(l.type === "MISC" && l.description === "Round off"),
  );

  // Net payments by mode (received − refunded); a mode that nets to zero (a reversed or
  // duplicate tender) is hidden entirely, so the bill shows only the real money taken.
  const netByMode = new Map<string, number>();
  for (const p of folio.payments) {
    netByMode.set(p.mode, (netByMode.get(p.mode) ?? 0) + (p.isRefund ? -p.amountPaise : p.amountPaise));
  }
  const netPayments = [...netByMode.entries()].filter(([, amt]) => amt !== 0);

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
          {activeLines.length === 0 ? (
            <p className="text-muted-foreground">No charges posted yet.</p>
          ) : (
            <ul className="space-y-1">
              {activeLines.map((l) => {
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

        {/* Payments — netted per mode; reversed/duplicate tenders don't show. */}
        {netPayments.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payments</p>
            <ul className="space-y-1">
              {netPayments.map(([mode, amt]) => (
                <li key={mode} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{mode.replace(/_/g, " ")}{amt < 0 ? " (refund)" : ""}</span>
                  <span className="shrink-0 tabular">{amt < 0 ? "+" : "−"} {formatINR(Math.abs(amt))}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Totals */}
        <div className="space-y-1 border-t pt-3">
          <Row label="Taxable value" value={formatINR(taxable)} muted />
          {/* On-premise supplies are always intra-state (business-rules §10) → CGST+SGST. */}
          <Row label="GST (CGST + SGST)" value={formatINR(tax)} muted />
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
