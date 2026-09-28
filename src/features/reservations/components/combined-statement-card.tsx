/**
 * Combined guest statement across a cross-property transfer (03). When a guest's
 * stay spans two (or more) properties via a transfer, this shows ONE bill — each
 * property segment (dates, charges, tax, paid, balance) plus a grand total the guest
 * pays. Each property still keeps its own correct folio/GST invoice; this is the
 * guest-facing consolidated view. Only rendered when the booking is part of a chain.
 */
import Link from "next/link";
import { ArrowRightLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR, formatDayMonth } from "@/lib/utils";
import type { TransferStatement } from "../queries";

export function CombinedStatementCard({ statement }: { statement: TransferStatement }) {
  if (!statement.isTransfer) return null;
  const s = statement;
  return (
    <Card className="mt-4 border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary">
          <ArrowRightLeft /> Combined stay statement
        </CardTitle>
        <p className="text-sm text-muted-foreground">This guest was transferred across properties — here is the whole stay as one bill. Each property is invoiced separately for GST.</p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 px-3 font-medium">Property</th>
                <th className="py-2 px-3 font-medium">Dates</th>
                <th className="py-2 px-3 text-right font-medium">Charges</th>
                <th className="py-2 px-3 text-right font-medium">GST</th>
                <th className="py-2 px-3 text-right font-medium">Paid</th>
                <th className="py-2 px-3 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {s.segments.map((seg) => (
                <tr key={seg.reservationId} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="py-2.5 px-3">
                    <Link href={`/bookings/${seg.reservationId}`} className="font-medium text-primary hover:underline">{seg.propertyName}</Link>
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">{seg.code}</span>
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap text-muted-foreground">{formatDayMonth(seg.checkInDate)} → {formatDayMonth(seg.checkOutDate)}</td>
                  <td className="py-2.5 px-3 text-right tabular">{formatINR(seg.chargesPaise)}</td>
                  <td className="py-2.5 px-3 text-right tabular text-muted-foreground">{formatINR(seg.taxPaise)}</td>
                  <td className="py-2.5 px-3 text-right tabular text-muted-foreground">{formatINR(seg.paidPaise)}</td>
                  <td className={`py-2.5 px-3 text-right tabular ${seg.balancePaise > 0 ? "text-amber-700 dark:text-amber-400 font-medium" : ""}`}>{formatINR(seg.balancePaise)}</td>
                </tr>
              ))}
              <tr className="border-t-2 bg-muted/30 font-semibold">
                <td className="py-2.5 px-3" colSpan={2}>Grand total</td>
                <td className="py-2.5 px-3 text-right tabular">{formatINR(s.totalChargesPaise)}</td>
                <td className="py-2.5 px-3 text-right tabular">{formatINR(s.totalTaxPaise)}</td>
                <td className="py-2.5 px-3 text-right tabular">{formatINR(s.totalPaidPaise)}</td>
                <td className={`py-2.5 px-3 text-right tabular ${s.totalBalancePaise > 0 ? "text-amber-700 dark:text-amber-400" : "text-success"}`}>{formatINR(s.totalBalancePaise)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Total to collect from the guest across the whole stay: <span className="font-semibold text-foreground">{formatINR(s.totalBalancePaise)}</span>.</p>
      </CardContent>
    </Card>
  );
}
