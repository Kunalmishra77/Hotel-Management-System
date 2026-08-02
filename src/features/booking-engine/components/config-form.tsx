"use client";

/**
 * Staff booking-site configuration — 23 T-17b (AC-19). Calls the authenticated
 * server actions (gated on `bookingengine:manage` server-side). Deposit/stay/
 * cancel policy, sellable categories, gateway, and publish toggle.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateBookingEngineConfig, publishBookingSite } from "@/features/booking-engine/actions";

type Cfg = {
  slug: string;
  onlineSellableCategoryIds: string[];
  depositPolicy: string;
  depositValue: number;
  checkoutTtlMin: number;
  minLos: number;
  leadTimeDays: number;
  maxRoomsPerBooking: number;
  cancelWindowHours: number;
  isPublished: boolean;
} | null;

export function ConfigForm({
  propertyId,
  config,
  categories,
}: {
  propertyId: string;
  config: Cfg;
  categories: { id: string; name: string }[];
}): React.ReactElement {
  const [slug, setSlug] = useState(config?.slug ?? "");
  const [depositPolicy, setDepositPolicy] = useState(config?.depositPolicy ?? "PCT");
  const [depositValue, setDepositValue] = useState(config?.depositValue ?? 2000);
  const [ttl, setTtl] = useState(config?.checkoutTtlMin ?? 15);
  const [minLos, setMinLos] = useState(config?.minLos ?? 1);
  const [leadTimeDays, setLead] = useState(config?.leadTimeDays ?? 0);
  const [maxRooms, setMaxRooms] = useState(config?.maxRoomsPerBooking ?? 5);
  const [cancelWindow, setCancelWindow] = useState(config?.cancelWindowHours ?? 48);
  const [sellable, setSellable] = useState<string[]>(config?.onlineSellableCategoryIds ?? []);
  const [published, setPublished] = useState(config?.isPublished ?? false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(id: string): void {
    setSellable((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function save(): Promise<void> {
    setBusy(true);
    setMsg(null);
    const res = await updateBookingEngineConfig({
      propertyId, slug: slug || undefined, onlineSellableCategoryIds: sellable,
      depositPolicy: depositPolicy as "FULL" | "PCT" | "FIXED", depositValue,
      checkoutTtlMin: ttl, minLos, leadTimeDays, maxRoomsPerBooking: maxRooms, cancelWindowHours: cancelWindow,
    });
    setMsg(res.ok ? "Saved." : res.error.message);
    setBusy(false);
  }

  async function togglePublish(): Promise<void> {
    setBusy(true);
    setMsg(null);
    const res = await publishBookingSite({ propertyId, isPublished: !published });
    if (res.ok) setPublished(res.data.isPublished);
    setMsg(res.ok ? (res.data.isPublished ? "Published." : "Unpublished.") : res.error.message);
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader><CardTitle>Booking site</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="cf-slug">Public link (slug)</Label>
          <Input id="cf-slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="woodpecker-mg" />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Online-sellable categories</legend>
          {categories.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={sellable.includes(c.id)} onChange={() => toggle(c.id)} className="h-5 w-5" />
              {c.name}
            </label>
          ))}
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="cf-policy">Deposit policy</Label>
            <select id="cf-policy" value={depositPolicy} onChange={(e) => setDepositPolicy(e.target.value)} className="h-10 w-full rounded-md border px-2">
              <option value="FULL">Full</option>
              <option value="PCT">Percent</option>
              <option value="FIXED">Fixed</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cf-value">Deposit value {depositPolicy === "PCT" ? "(bps, 2000=20%)" : depositPolicy === "FIXED" ? "(paise)" : ""}</Label>
            <Input id="cf-value" type="number" value={depositValue} onChange={(e) => setDepositValue(Number(e.target.value))} />
          </div>
          <div className="space-y-1"><Label htmlFor="cf-ttl">Checkout TTL (min)</Label><Input id="cf-ttl" type="number" value={ttl} onChange={(e) => setTtl(Number(e.target.value))} /></div>
          <div className="space-y-1"><Label htmlFor="cf-minlos">Min nights</Label><Input id="cf-minlos" type="number" value={minLos} onChange={(e) => setMinLos(Number(e.target.value))} /></div>
          <div className="space-y-1"><Label htmlFor="cf-lead">Lead time (days)</Label><Input id="cf-lead" type="number" value={leadTimeDays} onChange={(e) => setLead(Number(e.target.value))} /></div>
          <div className="space-y-1"><Label htmlFor="cf-max">Max rooms/booking</Label><Input id="cf-max" type="number" value={maxRooms} onChange={(e) => setMaxRooms(Number(e.target.value))} /></div>
          <div className="space-y-1"><Label htmlFor="cf-cancel">Cancel window (h)</Label><Input id="cf-cancel" type="number" value={cancelWindow} onChange={(e) => setCancelWindow(Number(e.target.value))} /></div>
        </div>
        {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
        <div className="flex gap-2">
          <Button onClick={save} disabled={busy} className="flex-1">Save</Button>
          <Button variant={published ? "outline" : "default"} onClick={togglePublish} disabled={busy} className="flex-1">
            {published ? "Unpublish" : "Publish"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
