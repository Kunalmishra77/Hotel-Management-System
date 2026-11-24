/**
 * Folio → "What Expedia / MMT pays" (client, 24 Nov 2026). The guest's price stays
 * the bill (GST is on it); this shows what the OTA keeps and what it remits, from
 * the channel's rule in Reports → Channels.
 */
import { Fragment } from "react";
import Link from "next/link";
import { formatINR } from "@/lib/utils";
import type { OtaPayout } from "../ota-payout";


export function OtaPayoutCard({ payouts }: { payouts: OtaPayout[] }) {
  if (payouts.length === 0) return null;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-6">
      {payouts.map((p) => {
        const rows: [string, number][] = [
          ["Commission", p.commissionPaise],
          ...(p.extraFeePaise ? [[p.extraFeeLabel || "Other fee", p.extraFeePaise] as [string, number]] : []),
          ...(p.gstOnCommissionPaise ? [["GST on commission", p.gstOnCommissionPaise] as [string, number]] : []),
          ...(p.tcsPaise ? [["TCS (credited to you later)", p.tcsPaise] as [string, number]] : []),
          ...(p.tdsPaise ? [["TDS (credited to you later)", p.tdsPaise] as [string, number]] : []),
        ];
        return (
          <section key={p.source} className="space-y-2 rounded-xl border bg-card p-4" data-testid={`ota-payout-${p.source}`}>
            <h2 className="text-base font-semibold">What {p.label} pays you</h2>
            {!p.ruleSet ? (
              <p className="text-sm text-muted-foreground">
                {p.label}&apos;s commission isn&apos;t set yet. Enter it from one of its statements in{" "}
                <Link href="/reports?report=source" className="text-primary underline-offset-2 hover:underline">Reports → Channels</Link>.
              </p>
            ) : null}
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
              <dt>Guest paid {p.label} (room {formatINR(p.basePaise)} + GST {formatINR(p.gstPaise)})</dt><dd className="text-right">{formatINR(p.grossPaise)}</dd>
              {rows.map(([label, v]) => (<Fragment key={label}><dt className="text-muted-foreground">{label}</dt><dd className="text-right text-muted-foreground">−{formatINR(v)}</dd></Fragment>))}
              <dt className="border-t pt-1 font-semibold">{p.label} pays you</dt><dd className="border-t pt-1 text-right font-semibold" data-testid="ota-payout-net">{formatINR(p.netPaise)}</dd>
            </dl>
            <p className="text-xs text-muted-foreground">The bill stays at the guest&apos;s price — GST is due on that. The difference is {p.label}&apos;s cost, shown in Reports → Channels. Estimate from the channel&apos;s rule; the OTA&apos;s statement can differ by a few paise.</p>
          </section>
        );
      })}
    </div>
  );
}
