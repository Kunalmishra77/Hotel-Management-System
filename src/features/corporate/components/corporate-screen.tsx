"use client";

/**
 * Corporate CRM screen — 25 T-13 (AC-1/3/6/7). Master-data management with a
 * credit gauge, account statement (aging) and agent commission. Mobile-first:
 * ≥44px actions, single-column on phone. All mutations + RBAC are enforced
 * server-side; this UI only surfaces the typed error.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createCorporate, createAgent, setNegotiatedRate } from "../actions";
import type { CorporateListItem, AgentListItem, CorporateStatement, AgentCommissionRow } from "../queries";

const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;
const toPaise = (r: number) => Math.round(r * 100);

type ActionResult = { ok: boolean; error?: { message: string } };

export function CorporateScreen({
  corporates, agents, statements, commission, canSeeMoney,
}: {
  corporates: CorporateListItem[];
  agents: AgentListItem[];
  statements: CorporateStatement[];
  commission: AgentCommissionRow[];
  canSeeMoney: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [cName, setCName] = useState("");
  const [cGstin, setCGstin] = useState("");
  const [cLimit, setCLimit] = useState(0);
  const [aName, setAName] = useState("");
  const [aPct, setAPct] = useState(0);

  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) { onOk?.(); router.refresh(); }
      else setError(res.error?.message ?? "Something went wrong.");
    });
  };

  const stmtFor = (id: string) => statements.find((s) => s.corporateId === id);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Corporate &amp; travel agents</h1>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">New corporate</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="c-name">Name</Label><Input id="c-name" value={cName} onChange={(e) => setCName(e.target.value)} data-testid="corp-name" /></div>
            <div className="space-y-1.5"><Label htmlFor="c-gstin">GSTIN</Label><Input id="c-gstin" value={cGstin} onChange={(e) => setCGstin(e.target.value)} data-testid="corp-gstin" /></div>
            <div className="space-y-1.5"><Label htmlFor="c-limit">Credit limit (₹)</Label><Input id="c-limit" type="number" inputMode="numeric" value={cLimit} onChange={(e) => setCLimit(Number(e.target.value))} data-testid="corp-limit" /></div>
            <Button size="lg" disabled={pending || !cName || cLimit < 0}
              onClick={() => run(() => createCorporate({ name: cName, gstin: cGstin || undefined, creditLimitPaise: toPaise(cLimit) }), () => { setCName(""); setCGstin(""); setCLimit(0); })}
              data-testid="corp-save">Add corporate</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">New travel agent</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="a-name">Name</Label><Input id="a-name" value={aName} onChange={(e) => setAName(e.target.value)} data-testid="agent-name" /></div>
            <div className="space-y-1.5"><Label htmlFor="a-pct">Commission (%)</Label><Input id="a-pct" type="number" inputMode="decimal" value={aPct} onChange={(e) => setAPct(Number(e.target.value))} data-testid="agent-pct" /></div>
            <Button size="lg" disabled={pending || !aName || aPct < 0}
              onClick={() => run(() => createAgent({ name: aName, commissionBps: Math.round(aPct * 100) }), () => { setAName(""); setAPct(0); })}
              data-testid="agent-save">Add agent</Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Corporates</CardTitle></CardHeader>
        <CardContent>
          {corporates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No corporate accounts yet.</p>
          ) : (
            <ul className="space-y-3" data-testid="corp-list">
              {corporates.map((c) => {
                const usedBps = c.creditLimitPaise > 0 ? Math.min(100, Math.round((c.receivablePaise / c.creditLimitPaise) * 100)) : 0;
                const stmt = stmtFor(c.id);
                return (
                  <li key={c.id} className="rounded-md border p-3 text-sm" data-testid={`corp-${c.id}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{c.name}{c.gstin ? <span className="ml-2 text-xs text-muted-foreground">GSTIN {c.gstin}</span> : null}</p>
                      <span className="text-xs text-muted-foreground">Limit {rupees(c.creditLimitPaise)}</span>
                    </div>
                    <div className="mt-2">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                        <div className="h-full bg-primary" style={{ width: `${usedBps}%` }} data-testid={`corp-gauge-${c.id}`} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Receivable <span data-testid={`corp-receivable-${c.id}`}>{rupees(c.receivablePaise)}</span>
                        {" · "}Available {rupees(c.availableCreditPaise)}
                      </p>
                    </div>
                    {c.negotiatedRates.length > 0 && (
                      <p className="mt-2 text-xs">Negotiated: {c.negotiatedRates.map((r) => `${r.roomCategoryId}=${rupees(r.ratePaise)}`).join(", ")}</p>
                    )}
                    <NegotiatedRateForm corporateId={c.id} pending={pending} run={run} />
                    {canSeeMoney && stmt && <Statement stmt={stmt} />}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Travel agents{canSeeMoney ? " · commission payable" : ""}</CardTitle></CardHeader>
        <CardContent>
          {agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No travel agents yet.</p>
          ) : (
            <ul className="divide-y rounded-md border" data-testid="agent-list">
              {agents.map((a) => {
                const pay = commission.find((r) => r.id === a.id);
                return (
                  <li key={a.id} className="flex items-center justify-between gap-2 p-3 text-sm" data-testid={`agent-${a.id}`}>
                    <span className="font-medium">{a.name} <span className="text-xs text-muted-foreground">{(a.commissionBps / 100).toLocaleString("en-IN")}%</span></span>
                    {canSeeMoney && <span className="text-xs text-muted-foreground" data-testid={`agent-commission-${a.id}`}>{rupees(pay?.commissionPayablePaise ?? 0)}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NegotiatedRateForm({ corporateId, pending, run }: { corporateId: string; pending: boolean; run: (fn: () => Promise<ActionResult>, onOk?: () => void) => void }) {
  const [cat, setCat] = useState("");
  const [rate, setRate] = useState(0);
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <div className="space-y-1"><Label htmlFor={`nr-cat-${corporateId}`} className="text-xs">Category id</Label><Input id={`nr-cat-${corporateId}`} value={cat} onChange={(e) => setCat(e.target.value)} className="h-9 w-40" data-testid={`nr-cat-${corporateId}`} /></div>
      <div className="space-y-1"><Label htmlFor={`nr-rate-${corporateId}`} className="text-xs">Rate (₹)</Label><Input id={`nr-rate-${corporateId}`} type="number" inputMode="numeric" value={rate} onChange={(e) => setRate(Number(e.target.value))} className="h-9 w-28" data-testid={`nr-rate-${corporateId}`} /></div>
      <Button size="sm" disabled={pending || !cat || rate <= 0}
        onClick={() => run(() => setNegotiatedRate({ corporateId, roomCategoryId: cat, ratePaise: toPaise(rate) }), () => { setCat(""); setRate(0); })}
        data-testid={`nr-save-${corporateId}`}>Set rate</Button>
    </div>
  );
}

function Statement({ stmt }: { stmt: CorporateStatement }) {
  return (
    <div className="mt-3 rounded-md bg-muted/40 p-2 text-xs" data-testid={`stmt-${stmt.corporateId}`}>
      <p className="font-medium">Statement</p>
      <p className="text-muted-foreground">
        Balance {rupees(stmt.receivablePaise)} · Paid {rupees(stmt.paidPaise)} ·
        {" "}0-30 {rupees(stmt.aging.current)} · 31-60 {rupees(stmt.aging.days31to60)} ·
        {" "}61-90 {rupees(stmt.aging.days61to90)} · 90+ {rupees(stmt.aging.days90plus)}
      </p>
    </div>
  );
}
