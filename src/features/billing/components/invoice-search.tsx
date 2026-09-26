"use client";

/**
 * Searchable + filterable invoice list for the Billing page. Search by customer
 * name or invoice number; filter by property and issue-date range; each row opens
 * the GST invoice PDF. Debounced; "Load more" pages through with the cursor.
 */
import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/utils";
import { searchBillingInvoices, shareInvoice } from "../invoice-actions";
import type { InvoiceListItem } from "../queries";

type PropertyOpt = { id: string; name: string };
const fmtDate = (d: Date) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export function InvoiceSearch({ properties, gstOnly: initialGst = false }: { properties: PropertyOpt[]; gstOnly?: boolean }) {
  const [gstOnly, setGstOnly] = useState(initialGst); // tab: false = all invoices, true = GST claims
  const [keyword, setKeyword] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<InvoiceListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shareState, setShareState] = useState<Record<string, string>>({});

  const share = async (id: string) => {
    setShareState((s) => ({ ...s, [id]: "Sending…" }));
    const res = await shareInvoice({ invoiceId: id });
    setShareState((s) => ({
      ...s,
      [id]: res.ok ? `Sent: ${res.data.sent.join(", ")}` : (res.error?.message ?? "Failed"),
    }));
  };

  const run = useCallback(async (append: boolean, cur: string | null) => {
    setLoading(true);
    const res = await searchBillingInvoices({ keyword, propertyId, from, to, gstOnly, cursor: append ? (cur ?? undefined) : undefined });
    setLoading(false);
    if (!res.ok) return;
    setRows((prev) => (append ? [...prev, ...res.data.invoices] : res.data.invoices));
    setCursor(res.data.nextCursor);
  }, [keyword, propertyId, from, to, gstOnly]);

  // Debounced reload whenever a filter changes.
  useEffect(() => {
    const t = setTimeout(() => { void run(false, null); }, 300);
    return () => clearTimeout(t);
  }, [run]);

  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{gstOnly ? "GST claim invoices" : "Bills & invoices"}</CardTitle>
          <div className="inline-flex rounded-lg border bg-card p-0.5 text-sm" role="group" aria-label="Invoice view">
            <button type="button" onClick={() => setGstOnly(false)} data-testid="tab-all-invoices"
              className={!gstOnly ? "rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground" : "rounded-md px-3 py-1 text-muted-foreground hover:text-foreground"}>All invoices</button>
            <button type="button" onClick={() => setGstOnly(true)} data-testid="tab-gst-claims"
              className={gstOnly ? "rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground" : "rounded-md px-3 py-1 text-muted-foreground hover:text-foreground"}>GST claims</button>
          </div>
        </div>
        {gstOnly ? <p className="mt-1 text-xs text-muted-foreground">Invoices with a guest GSTIN on file — for input-tax-credit claims.</p> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5 lg:col-span-1">
            <Label>Customer or invoice no.</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Name or WASF/…" className="pl-8" data-testid="invoice-search" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Property</Label>
            <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="invoice-property">
              <option value="">All properties</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        {(keyword || propertyId || from || to) && (
          <button type="button" onClick={() => { setKeyword(""); setPropertyId(""); setFrom(""); setTo(""); }} className="text-xs text-muted-foreground underline underline-offset-4">
            Clear filters
          </button>
        )}

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pl-3 pr-3 font-medium">Invoice no.</th>
                <th className="py-2 px-3 font-medium">Date</th>
                <th className="py-2 px-3 font-medium">Customer</th>
                {gstOnly ? <th className="py-2 px-3 font-medium">Guest GSTIN</th> : null}
                <th className="py-2 px-3 font-medium">Property</th>
                <th className="py-2 px-3 text-right font-medium">Total</th>
                <th className="py-2 pl-3 pr-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="invoice-rows">
              {rows.length === 0 ? (
                <tr><td colSpan={gstOnly ? 7 : 6} className="py-6 text-center text-muted-foreground">{loading ? "Searching…" : "No invoices match."}</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2.5 pl-3 pr-3 font-mono text-xs">{r.number}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-muted-foreground">{fmtDate(r.issuedAt)}</td>
                    <td className="py-2.5 px-3 font-medium">{r.customerName}</td>
                    {gstOnly ? <td className="py-2.5 px-3 font-mono text-xs">{r.customerGstin ?? "—"}</td> : null}
                    <td className="py-2.5 px-3 text-muted-foreground">{r.propertyName}</td>
                    <td className="py-2.5 px-3 text-right tabular">{formatINR(r.totalPaise)}</td>
                    <td className="py-2.5 pl-3 pr-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <a href={`/api/invoices/${r.id}`} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">View</a>
                        <button type="button" onClick={() => void share(r.id)} className="text-primary underline underline-offset-4">Share</button>
                      </div>
                      {shareState[r.id] ? <p className="mt-1 text-xs text-muted-foreground">{shareState[r.id]}</p> : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {cursor && (
          <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void run(true, cursor)} data-testid="invoice-load-more">
            {loading ? "Loading…" : "Load more"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
