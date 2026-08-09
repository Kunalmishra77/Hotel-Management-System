"use client";

/**
 * 27 owner-portal — payout statements (FR-14). The owner views + downloads; staff
 * with owner:payout-manage can record a month's payout and mark it paid. Money
 * comes straight from the snapshot (never recomputed here).
 */
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatINR } from "@/lib/utils";
import { recordOwnerPayout, markPayoutPaid, setManagementFee } from "../payout-actions";
import type { OwnerPayoutItem } from "../queries";

export function PayoutList({
  propertyId,
  payouts,
  canManage,
  canManageFee,
  feeBps,
}: {
  propertyId: string;
  payouts: OwnerPayoutItem[];
  canManage: boolean;
  canManageFee: boolean;
  feeBps: number;
}) {
  const [month, setMonth] = useState("");
  const [feePct, setFeePct] = useState((feeBps / 100).toString());
  const [pending, start] = useTransition();

  function saveFee() {
    const pct = Number(feePct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return toast.error("Enter a fee between 0 and 100%.");
    start(async () => {
      const res = await setManagementFee({ propertyId, feeBps: Math.round(pct * 100) });
      if (res.ok) toast.success("Management fee updated.");
      else toast.error(res.error.message);
    });
  }

  function record() {
    if (!month) return toast.error("Pick a month to record.");
    start(async () => {
      const res = await recordOwnerPayout({ propertyId, periodMonth: `${month}-01` });
      if (res.ok) {
        toast.success(res.data.idempotent ? "Already recorded for that month." : "Payout recorded.");
        location.reload();
      } else toast.error(res.error.message);
    });
  }

  function markPaid(id: string) {
    const ref = window.prompt("Payment reference (UTR / transaction id):");
    if (!ref || !ref.trim()) return;
    start(async () => {
      const res = await markPayoutPaid({ payoutId: id, paymentRef: ref.trim() });
      if (res.ok) {
        toast.success("Marked paid.");
        location.reload();
      } else toast.error(res.error.message);
    });
  }

  return (
    <div className="space-y-4">
      {canManageFee ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border p-4" data-testid="set-fee">
          <div className="space-y-1">
            <label htmlFor="fee-pct" className="text-xs text-muted-foreground">Management fee (% of revenue)</label>
            <Input id="fee-pct" inputMode="decimal" value={feePct} onChange={(e) => setFeePct(e.target.value)} className="w-40" />
          </div>
          <Button size="sm" variant="outline" onClick={saveFee} disabled={pending}>Save fee</Button>
        </div>
      ) : null}

      {canManage ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border p-4" data-testid="record-payout">
          <div className="space-y-1">
            <label htmlFor="payout-month" className="text-xs text-muted-foreground">Record month</label>
            <Input id="payout-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <Button size="sm" onClick={record} disabled={pending}><Plus className="size-4" /> Record payout</Button>
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Statements</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {payouts.length === 0 ? (
            <div className="px-4 pb-2">
              <EmptyState title="No payouts yet" description="Recorded monthly payouts appear here." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="payout-list">
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Fee</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payouts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.period}</TableCell>
                      <TableCell className="text-right tabular">{formatINR(p.grossRevenuePaise)}</TableCell>
                      <TableCell className="text-right tabular">{formatINR(p.managementFeePaise)}</TableCell>
                      <TableCell className={`text-right tabular font-medium ${p.netPayablePaise < 0 ? "text-destructive" : ""}`}>
                        {formatINR(p.netPayablePaise)}
                      </TableCell>
                      <TableCell>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.status === "PAID" ? "bg-success/12 text-success" : "bg-warning/12 text-warning"}`}>
                          {p.status === "PAID" ? "Paid" : "Computed"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button asChild variant="outline" size="sm">
                            <a href={`/owner/payouts/${p.id}`} data-testid="payout-download"><Download className="size-4" /></a>
                          </Button>
                          {canManage && p.status !== "PAID" ? (
                            <Button variant="outline" size="sm" onClick={() => markPaid(p.id)} disabled={pending} data-testid="payout-mark-paid">
                              Mark paid
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
