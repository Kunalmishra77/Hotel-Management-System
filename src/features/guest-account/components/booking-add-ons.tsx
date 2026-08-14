"use client";
/**
 * Guest add-ons panel on the booking detail page (Wave 3). Lists the property's
 * available extras with a quantity stepper + Request, and the guest's own requests
 * with a status pill. Requesting doesn't charge — reception accepts, then the
 * amount appears on the folio at the desk.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Minus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { requestAddOn } from "../upsell-actions";
import type { BookingAddOns } from "../queries";

const rupees = (paise: number): string =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const STATUS: Record<string, { label: string; variant: "secondary" | "success" | "default" }> = {
  REQUESTED: { label: "Requested", variant: "secondary" },
  ACCEPTED: { label: "Added to your bill", variant: "success" },
  DECLINED: { label: "Declined", variant: "default" },
};

export function BookingAddOns({ reservationId, data }: { reservationId: string; data: BookingAddOns }) {
  if (!data.canRequest && data.mine.length === 0) return null;

  return (
    <div className="space-y-4">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="size-4 text-primary" aria-hidden="true" /> Enhance your stay
      </h2>

      {data.mine.length > 0 && (
        <ul className="space-y-2">
          {data.mine.map((m) => {
            const s = STATUS[m.status] ?? STATUS.REQUESTED!;
            return (
              <li key={m.id} className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  {m.name}
                  {m.quantity > 1 ? <span className="text-muted-foreground"> × {m.quantity}</span> : null}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="tabular text-muted-foreground">{rupees(m.unitPaise * m.quantity)}</span>
                  <Badge variant={s.variant}>{s.label}</Badge>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {data.canRequest && data.available.length > 0 && (
        <div className="space-y-2">
          {data.mine.length > 0 && <p className="eyebrow">Add more</p>}
          {data.available.map((a) => (
            <AddOnRow key={a.id} reservationId={reservationId} id={a.id} name={a.name} description={a.description} pricePaise={a.pricePaise} />
          ))}
          <p className="text-xs text-muted-foreground">
            Prices include GST. Extras are confirmed by reception and added to your bill at the hotel — nothing is charged now.
          </p>
        </div>
      )}
    </div>
  );
}

function AddOnRow({
  reservationId, id, name, description, pricePaise,
}: {
  reservationId: string;
  id: string;
  name: string;
  description: string | null;
  pricePaise: number;
}) {
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function request() {
    setError(null);
    start(async () => {
      const res = await requestAddOn({ reservationId, addOnId: id, quantity: qty });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{name}</p>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        <span className="shrink-0 text-sm font-semibold tabular">{rupees(pricePaise)}</span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="inline-flex items-center rounded-md border">
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            disabled={qty <= 1 || pending}
            className="grid size-9 place-items-center text-muted-foreground disabled:opacity-40"
            aria-label="Decrease quantity"
          >
            <Minus className="size-4" />
          </button>
          <span className="w-8 text-center text-sm tabular">{qty}</span>
          <button
            type="button"
            onClick={() => setQty((q) => Math.min(10, q + 1))}
            disabled={qty >= 10 || pending}
            className="grid size-9 place-items-center text-muted-foreground disabled:opacity-40"
            aria-label="Increase quantity"
          >
            <Plus className="size-4" />
          </button>
        </div>
        <Button size="sm" onClick={request} disabled={pending}>
          <Plus className="size-4" aria-hidden="true" /> {pending ? "Requesting…" : "Request"}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
