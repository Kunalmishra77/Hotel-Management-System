"use client";

/**
 * Reports → Channels: set what each OTA keeps (commission %, on pre-GST or
 * GST-inclusive value, GST on commission, TCS, TDS). Saved per channel; the
 * breakdown above recomputes on save. `settings:manage` (server-enforced).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BOOKING_SOURCE_LABEL } from "@/lib/constants/company";
import { saveChannelDeduction } from "../ota-deduction-actions";
import type { DeductionRule } from "../domain/ota-deduction";

type Rules = Record<string, DeductionRule & { set: boolean }>;
const toPct = (bps: number) => String(bps / 100);
const toBps = (pct: string) => Math.round(Number(pct) * 100);

export function OtaDeductionSettings({ rules, canEdit }: { rules: Rules; canEdit: boolean }) {
  return (
    <details className="rounded-lg border bg-card p-3" open={Object.values(rules).every((r) => !r.set)} data-testid="ota-settings">
      <summary className="cursor-pointer text-sm font-semibold">OTA commission settings</summary>
      <p className="mt-1 text-xs text-muted-foreground">
        Enter each channel&apos;s commission from its contract or payout statement. TCS (0.5%) and TDS (0.1%) are what OTAs withhold by law — both come back as tax credit. GST on commission is claimable as input credit.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            {["Channel", "Commission %", "Commission on", "GST on commission %", "TCS %", "TDS %", ""].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {Object.entries(rules).map(([source, rule]) => <Row key={source} source={source} rule={rule} canEdit={canEdit} />)}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Row({ source, rule, canEdit }: { source: string; rule: DeductionRule & { set: boolean }; canEdit: boolean }) {
  const router = useRouter();
  const [v, setV] = useState({ c: toPct(rule.commissionBps), gross: rule.commissionOnGross, g: toPct(rule.gstOnCommissionBps), tcs: toPct(rule.tcsBps), tds: toPct(rule.tdsBps) });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const bad = [v.c, v.g, v.tcs, v.tds].some((x) => x.trim() === "" || !Number.isFinite(Number(x)) || Number(x) < 0 || Number(x) > 100);
  const save = () => start(async () => {
    const res = await saveChannelDeduction({ source, commissionBps: toBps(v.c), commissionOnGross: v.gross, gstOnCommissionBps: toBps(v.g), tcsBps: toBps(v.tcs), tdsBps: toBps(v.tds) });
    setMsg(res.ok ? "Saved" : res.error.message);
    if (res.ok) router.refresh();
  });
  const num = (k: "c" | "g" | "tcs" | "tds", label: string) => (
    <Input type="number" step="0.01" min="0" max="100" inputMode="decimal" value={v[k]} disabled={!canEdit} aria-label={`${label} for ${source}`} className="w-24"
      onChange={(e) => setV({ ...v, [k]: e.target.value })} />
  );
  return (
    <tr className="border-t">
      <td className="px-2 py-2 font-medium">{BOOKING_SOURCE_LABEL[source] ?? source}{!rule.set ? <span className="block text-xs font-normal text-warning">commission not set</span> : null}</td>
      <td className="px-2 py-2">{num("c", "Commission")}</td>
      <td className="px-2 py-2">
        <select className="h-11 rounded-md border bg-background px-2 text-sm" disabled={!canEdit} value={v.gross ? "gross" : "net"} onChange={(e) => setV({ ...v, gross: e.target.value === "gross" })} aria-label={`Commission base for ${source}`}>
          <option value="net">Amount before GST</option>
          <option value="gross">Amount incl. GST</option>
        </select>
      </td>
      <td className="px-2 py-2">{num("g", "GST on commission")}</td>
      <td className="px-2 py-2">{num("tcs", "TCS")}</td>
      <td className="px-2 py-2">{num("tds", "TDS")}</td>
      <td className="px-2 py-2">
        {canEdit ? <Button size="sm" disabled={pending || bad} onClick={save}>{pending ? "Saving…" : "Save"}</Button> : null}
        {msg ? <span className="ml-2 text-xs text-muted-foreground">{msg}</span> : null}
      </td>
    </tr>
  );
}
