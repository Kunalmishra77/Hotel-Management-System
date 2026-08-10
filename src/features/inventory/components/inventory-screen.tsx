"use client";

/**
 * Inventory screen — 20 T-11 (AC-1/2/5). Mobile-first: the stock list with
 * low-stock badges, a quick "stock in" form, and per-item stock-out / stock-take.
 * RBAC + the negative-stock guard are enforced server-side; this UI just surfaces
 * the result. Actions ≥44px for thumb use (mobile-first.md).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Shirt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatStrip } from "@/components/ui/stat-strip";
import { createItem, recordMovement, adjustStock } from "../actions";
import { INVENTORY_DOMAINS } from "../schema";
import type { StockLevel, InventoryOverview } from "../queries";

type ActionResult = { ok: boolean; error?: { message: string } };

const DOMAIN_LABEL: Record<string, string> = {
  GENERAL: "General", HOUSEKEEPING: "Housekeeping", LAUNDRY: "Laundry",
  KITCHEN: "Kitchen", MAINTENANCE: "Maintenance", STORE: "Store",
};

export function InventoryScreen({ propertyId, items, overview }: { propertyId: string; items: StockLevel[]; overview: InventoryOverview }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // New-item form
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("kg");
  const [domain, setDomain] = useState<string>("GENERAL");
  const [category, setCategory] = useState("Provisions");
  const [reorder, setReorder] = useState(0);

  // Domain filter for the list
  const [filter, setFilter] = useState<string>("ALL");
  const shown = filter === "ALL" ? items : items.filter((i) => i.domain === filter);

  // Per-item stock-in quantity
  const [qty, setQty] = useState<Record<string, number>>({});

  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) { onOk?.(); router.refresh(); }
      else setError(res.error?.message ?? "Something went wrong.");
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Stock</h1>
        <Button asChild variant="outline" size="sm"><Link href="/inventory/laundry" data-testid="laundry-link"><Shirt className="size-4" /> Laundry</Link></Button>
      </div>

      <StatStrip
        className="grid-cols-2 sm:grid-cols-4"
        items={[
          { label: "Items", value: overview.totalItems },
          { label: "Low stock", value: overview.lowStock, tone: overview.lowStock > 0 ? "warning" : "default" },
          { label: "Out of stock", value: overview.outOfStock, tone: overview.outOfStock > 0 ? "danger" : "default" },
          { label: "Open laundry", value: overview.openLaundryBatches },
        ]}
      />

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Add an item</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="inv-name">Name</Label><Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="item-name" /></div>
            <div className="space-y-1.5"><Label htmlFor="inv-unit">Unit</Label><Input id="inv-unit" value={unit} onChange={(e) => setUnit(e.target.value)} data-testid="item-unit" /></div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-domain">Domain</Label>
              <Select value={domain} onValueChange={setDomain}>
                <SelectTrigger id="inv-domain" data-testid="item-domain"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INVENTORY_DOMAINS.map((dm) => <SelectItem key={dm} value={dm}>{DOMAIN_LABEL[dm] ?? dm}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="inv-cat">Category</Label><Input id="inv-cat" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="item-category" /></div>
            <div className="space-y-1.5"><Label htmlFor="inv-reorder">Reorder level</Label><Input id="inv-reorder" type="number" inputMode="decimal" value={reorder} onChange={(e) => setReorder(Number(e.target.value))} data-testid="item-reorder" /></div>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button size="lg" disabled={pending || name.trim() === "" || unit.trim() === ""}
            onClick={() => run(() => createItem({ propertyId, name, unit, domain, category, reorderLevel: reorder }), () => { setName(""); setReorder(0); })}
            data-testid="item-save">Add item</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">On hand</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1" data-testid="domain-filter">
            {["ALL", ...INVENTORY_DOMAINS].map((dm) => (
              <button
                key={dm}
                type="button"
                onClick={() => setFilter(dm)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${filter === dm ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
              >
                {dm === "ALL" ? "All" : DOMAIN_LABEL[dm] ?? dm}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stock items{filter !== "ALL" ? " in this domain" : ""} yet.</p>
          ) : (
            <ul className="divide-y rounded-md border" data-testid="stock-list">
              {shown.map((it) => (
                <li key={it.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm" data-testid={`stock-${it.id}`}>
                  <div className="min-w-[8rem]">
                    <p className="font-medium">
                      {it.name}
                      {it.low && <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive" data-testid={`low-${it.id}`}>⚠ low</span>}
                    </p>
                    <p className="text-xs text-muted-foreground" data-testid={`onhand-${it.id}`}>{DOMAIN_LABEL[it.domain] ?? it.domain} · {it.onHand} {it.unit} · reorder {it.reorderLevel}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number" inputMode="decimal" className="h-10 w-20"
                      aria-label={`Quantity for ${it.name}`}
                      value={qty[it.id] ?? 0}
                      onChange={(e) => setQty((q) => ({ ...q, [it.id]: Number(e.target.value) }))}
                      data-testid={`qty-${it.id}`}
                    />
                    <Button size="sm" disabled={pending || (qty[it.id] ?? 0) <= 0}
                      onClick={() => run(() => recordMovement({ itemId: it.id, delta: qty[it.id] ?? 0, reason: "PURCHASE" }), () => setQty((q) => ({ ...q, [it.id]: 0 })))}
                      data-testid={`stockin-${it.id}`}>+ In</Button>
                    <Button size="sm" variant="outline" disabled={pending || (qty[it.id] ?? 0) === 0}
                      onClick={() => run(() => adjustStock({ itemId: it.id, countedQuantity: qty[it.id] ?? 0 }), () => setQty((q) => ({ ...q, [it.id]: 0 })))}
                      data-testid={`count-${it.id}`}>Set count</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
