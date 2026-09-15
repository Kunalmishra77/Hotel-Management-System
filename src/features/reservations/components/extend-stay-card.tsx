"use client";

/**
 * Extend a current (in-house) or confirmed stay to a later check-out date. Picks a
 * new date and calls `extendStay`, which stretches the same room's allocation and
 * bills the extra nights already elapsed. Reception surface for "the guest stayed
 * longer than booked".
 */
import { useState, useTransition } from "react";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { extendStay } from "../move-actions";

export function ExtendStayCard({ reservationId, checkOutDate }: { reservationId: string; checkOutDate: string }) {
  const [date, setDate] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function submit() {
    setError(null);
    setDone(null);
    start(async () => {
      const res = await extendStay({ reservationId, newCheckOutDate: date });
      if (!res.ok) { setError(res.error.message); return; }
      setDone(date);
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
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="extend-date">New check-out date</Label>
            <Input id="extend-date" type="date" min={checkOutDate} value={date} onChange={(e) => setDate(e.target.value)} data-testid="extend-date" />
          </div>
          <Button type="button" onClick={submit} disabled={pending || !date || date <= checkOutDate} data-testid="extend-submit">
            {pending ? "Extending…" : "Extend stay"}
          </Button>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {done && <p className="rounded-md border border-emerald-600/30 bg-emerald-500/10 p-2 text-sm text-emerald-700 dark:text-emerald-400" data-testid="extend-done">✔ Stay extended to {done}.</p>}
      </CardContent>
    </Card>
  );
}
