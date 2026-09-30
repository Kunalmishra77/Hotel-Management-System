"use client";

/**
 * Edit a booking's nightly room rate after check-in. Reception often needs to fix
 * the per-guest rate (wrong tariff, OTA / negotiated rate). Calls `setRoomRate`,
 * which re-posts any already-charged room-nights at the new rate AND updates the
 * booking's rate so future nights / check-out use it. Amount entered in ₹.
 */
import { useState, useTransition } from "react";
import { IndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setRoomRate } from "../move-actions";
import { formatINR } from "@/lib/utils";

export function EditRoomRateCard({ reservationId, currentRatePaise }: { reservationId: string; currentRatePaise: number }) {
  const [rate, setRate] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function submit() {
    setError(null);
    setDone(null);
    start(async () => {
      const res = await setRoomRate({ reservationId, newRatePaise: Math.round(Number(rate) * 100) });
      if (!res.ok) { setError(res.error.message); return; }
      setDone(formatINR(res.data.newRatePaise));
      setRate("");
    });
  }

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary">
          <IndianRupee /> Edit room rate
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Wrong or changed nightly rate for this guest? Enter the correct rate — GST (5%) is applied automatically. Already-charged nights are re-billed at the new rate, and the rest of the stay uses it too. Current: <span className="font-medium text-foreground">{formatINR(currentRatePaise)}/night</span>.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-rate">New rate per night (₹)</Label>
            <Input id="edit-rate" type="number" inputMode="decimal" step="0.01" min={0} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 2500" className="w-44" data-testid="edit-rate" />
          </div>
          <Button type="button" onClick={submit} disabled={pending || !rate || Number(rate) <= 0} data-testid="edit-rate-submit">
            {pending ? "Saving…" : "Save rate"}
          </Button>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {done && <p className="rounded-md border border-emerald-600/30 bg-emerald-500/10 p-2 text-sm text-emerald-700 dark:text-emerald-400" data-testid="edit-rate-done">✔ Room rate updated to {done}/night.</p>}
      </CardContent>
    </Card>
  );
}
