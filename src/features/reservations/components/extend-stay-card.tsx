"use client";

/**
 * Extend a current (in-house) or confirmed stay to a later check-out date, with
 * an OPTIONAL new nightly rate for the added nights. Calls `extendStay`, which
 * stretches the same room's allocation and bills the extra nights.
 *
 * The rate belongs here because an extension is routinely agreed at a different
 * tariff, and the alternative — extend, then "Edit room rate" — re-prices the
 * WHOLE stay and destroys the rate already agreed for the earlier nights.
 * Leaving the rate blank keeps the booking's current rate.
 */
import { useState, useTransition } from "react";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { extendStay } from "../move-actions";
import { formatINR } from "@/lib/utils";

export function ExtendStayCard({
  reservationId,
  checkOutDate,
  currentRatePaise,
}: {
  reservationId: string;
  checkOutDate: string;
  currentRatePaise?: number;
}) {
  const [date, setDate] = useState("");
  const [rate, setRate] = useState("");
  const [gstMode, setGstMode] = useState<"inclusive" | "exclusive">("exclusive");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function submit() {
    setError(null);
    setDone(null);
    start(async () => {
      const res = await extendStay({
        reservationId,
        newCheckOutDate: date,
        // Blank → keep the booking's current rate.
        ...(rate && Number(rate) > 0 ? { ratePaise: Math.round(Number(rate) * 100), gstMode } : {}),
      });
      if (!res.ok) { setError(res.error.message); return; }
      setDone(date);
      setRate("");
    });
  }

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary">
          <CalendarPlus /> Extend stay
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Guest staying longer than booked? Set the new check-out date — the room is held for the extra nights and the extra nights are billed.
          {typeof currentRatePaise === "number" && (
            <> Current rate: <span className="font-medium text-foreground">{formatINR(currentRatePaise)}/night</span> (pre-tax).</>
          )}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="extend-date">New check-out date</Label>
            <Input id="extend-date" type="date" min={checkOutDate} value={date} onChange={(e) => setDate(e.target.value)} data-testid="extend-date" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="extend-rate">Rate / night for the extra nights (₹)</Label>
            <Input id="extend-rate" type="number" inputMode="decimal" step="0.01" min={0} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="same as now" className="w-52" data-testid="extend-rate" />
          </div>
          <Button type="button" onClick={submit} disabled={pending || !date || date <= checkOutDate} data-testid="extend-submit">
            {pending ? "Extending…" : "Extend stay"}
          </Button>
        </div>
        {rate !== "" && Number(rate) > 0 && (
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="extend-gst" value="exclusive" checked={gstMode === "exclusive"} onChange={() => setGstMode("exclusive")} data-testid="extend-gst-exclusive" />
              Add GST on top
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="extend-gst" value="inclusive" checked={gstMode === "inclusive"} onChange={() => setGstMode("inclusive")} data-testid="extend-gst-inclusive" />
              Rate includes GST
            </label>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          A new rate applies to the added nights and to the rest of the stay. Nights already billed keep the rate they were agreed at — use “Edit room rate” to change those.
        </p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {done && <p className="rounded-md border border-emerald-600/30 bg-emerald-500/10 p-2 text-sm text-emerald-700 dark:text-emerald-400" data-testid="extend-done">✔ Stay extended to {done}.</p>}
      </CardContent>
    </Card>
  );
}
