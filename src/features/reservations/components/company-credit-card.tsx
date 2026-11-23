"use client";

/**
 * Booking → Company credit (client, 23 Nov 2026: "a few credit companies — bill
 * mode credit, details put on the bill as they come"). Type the company (or pick a
 * saved one): the bill is made out to it, the guest checks out with the balance
 * due, and the balance waits under Reports → Company dues until the company pays.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BillToFields, emptyBillTo, type BillToValue } from "@/features/billing/components/bill-to-fields";
import { saveBillingCompany } from "@/features/corporate/billing-companies";
import { normalizeGstin, GSTIN_RE } from "@/lib/gstin";
import { setCompanyCredit } from "../company-credit-actions";
import type { CompanyCredit } from "../company-credit";

export function CompanyCreditCard({ reservationId, company }: { reservationId: string; company: CompanyCredit | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<BillToValue>({ ...emptyBillTo(), company: true });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const g = normalizeGstin(value.customerGstin);
  const problem = !value.customerName.trim() ? "Enter the company name." : g && !GSTIN_RE.test(g) ? "A GSTIN is 15 characters, e.g. 07AAHCT9474D1Z0." : null;

  const save = () => start(async () => {
    setError(null);
    const saved = await saveBillingCompany({ name: value.customerName.trim(), ...(g ? { gstin: g } : {}), address: value.customerAddress.trim() || undefined, state: value.customerState.trim() || undefined });
    if (!saved.ok) { setError(saved.error.message); return; }
    const res = await setCompanyCredit({ reservationId, corporateId: saved.data.id });
    if (!res.ok) { setError(res.error.message); return; }
    setOpen(false);
    router.refresh();
  });
  const remove = () => start(async () => {
    setError(null);
    const res = await setCompanyCredit({ reservationId, corporateId: null });
    if (!res.ok) setError(res.error.message); else router.refresh();
  });

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4" data-testid="company-credit">
      <h2 className="flex items-center gap-2 text-base font-semibold"><Building2 className="size-4 text-primary" aria-hidden="true" /> Company credit</h2>
      {company ? (
        <>
          <p className="text-sm">
            Billed to <strong>{company.name}</strong>{company.gstin ? <span className="font-mono text-xs text-muted-foreground"> · {company.gstin}</span> : null} — the company pays later.
          </p>
          <p className="text-xs text-muted-foreground">The guest can check out with the balance due; it shows under Reports → Company dues. When the company pays, record it with Take payment on this booking.</p>
          <Button size="sm" variant="ghost" disabled={pending} onClick={remove}>Remove company credit</Button>
        </>
      ) : open ? (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!problem) save(); }}>
          <BillToFields value={value} onChange={(v) => setValue({ ...v, company: true })} idPrefix="cc" />
          {problem && value.customerName.trim() ? <p className="text-xs text-muted-foreground">{problem}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending || !!problem} data-testid="cc-save">{pending ? "Saving…" : "Put on company credit"}</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">A company pays for this stay later? Bill it to the company — GSTIN and address can be added as they come.</p>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="cc-open">Bill to a company on credit</Button>
        </>
      )}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
