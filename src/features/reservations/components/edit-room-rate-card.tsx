"use client";

/**
 * Edit a booking's nightly room rate after check-in. Reception often needs to fix
 * the per-guest rate (wrong tariff, OTA / negotiated rate). Calls `setRoomRate`,
 * which re-posts already-charged room-nights at the new rate AND updates the
 * booking's rate so future nights / check-out use it. Amount entered in ₹.
 *
 * "Only part of the stay" exists because a stay legitimately carries more than
 * one agreed rate — an extension negotiated at a different tariff being the
 * common case. Re-pricing every night is right for a plain data-entry mistake
 * and wrong for that one, so the period is the operator's choice rather than an
 * assumption. Both dates the operator picks are inclusive; the action takes
 * `toNight` exclusive, like a check-out date.
 */
import { useState, useTransition } from "react";
import { IndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setRoomRate } from "../move-actions";
import { formatINR } from "@/lib/utils";

/** The night AFTER `iso` — turns an inclusive last night into an exclusive bound. */
function nightAfter(iso: string): string {
  return new Date(new Date(`${iso}T00:00:00.000Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
}

export function EditRoomRateCard({
  reservationId,
  currentRatePaise,
  stayFrom,
  stayTo,
}: {
  reservationId: string;
  currentRatePaise: number;
  /** Check-in date (the first night) — bounds the date pickers. */
  stayFrom?: string;
  /** Check-out date (exclusive) — bounds the date pickers. */
  stayTo?: string;
}) {
  const [rate, setRate] = useState("");
  const [gstMode, setGstMode] = useState<"inclusive" | "exclusive">("exclusive");
  const [wholeStay, setWholeStay] = useState(true);
  const [fromNight, setFromNight] = useState("");
  const [lastNight, setLastNight] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const windowReady = wholeStay || (!!fromNight && !!lastNight && fromNight <= lastNight);

  function submit() {
    setError(null);
    setDone(null);
    start(async () => {
      const res = await setRoomRate({
        reservationId,
        newRatePaise: Math.round(Number(rate) * 100),
        gstMode,
        ...(wholeStay ? {} : { fromNight, toNight: nightAfter(lastNight) }),
      });
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
          Wrong or changed nightly rate for this guest? Enter the correct rate and choose whether GST (5%) is already included or added on top. The nights you pick are re-billed at the new rate, and the rest of the stay uses it too. Current: <span className="font-medium text-foreground">{formatINR(currentRatePaise)}/night</span> (pre-tax).
        </p>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="edit-rate-gst" value="exclusive" checked={gstMode === "exclusive"} onChange={() => setGstMode("exclusive")} data-testid="edit-rate-exclusive" />
            Add GST on top
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="edit-rate-gst" value="inclusive" checked={gstMode === "inclusive"} onChange={() => setGstMode("inclusive")} data-testid="edit-rate-inclusive" />
            Rate includes GST
          </label>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="edit-rate-scope" checked={wholeStay} onChange={() => setWholeStay(true)} data-testid="edit-rate-whole" />
            Whole stay
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="edit-rate-scope" checked={!wholeStay} onChange={() => setWholeStay(false)} data-testid="edit-rate-partial" />
            Only part of the stay
          </label>
        </div>
        {!wholeStay && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-rate-from">First night to re-price</Label>
              <Input id="edit-rate-from" type="date" min={stayFrom} max={stayTo} value={fromNight} onChange={(e) => setFromNight(e.target.value)} data-testid="edit-rate-from" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-rate-to">Last night to re-price</Label>
              <Input id="edit-rate-to" type="date" min={fromNight || stayFrom} max={stayTo} value={lastNight} onChange={(e) => setLastNight(e.target.value)} data-testid="edit-rate-to" />
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-rate">New rate per night (₹)</Label>
            <Input id="edit-rate" type="number" inputMode="decimal" step="0.01" min={0} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 2500" className="w-44" data-testid="edit-rate" />
          </div>
          <Button type="button" onClick={submit} disabled={pending || !rate || Number(rate) <= 0 || !windowReady} data-testid="edit-rate-submit">
            {pending ? "Saving…" : "Save rate"}
          </Button>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {done && <p className="rounded-md border border-emerald-600/30 bg-emerald-500/10 p-2 text-sm text-emerald-700 dark:text-emerald-400" data-testid="edit-rate-done">✔ Room rate updated to {done}/night.</p>}
      </CardContent>
    </Card>
  );
}
