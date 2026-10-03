"use client";

/**
 * Change a booking's source/channel at any time (even after check-in) — e.g. an
 * OTA (MakeMyTrip) guest who cancels the OTA booking on arrival and continues as a
 * direct booking. Updates revenue-by-source reporting on save.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { changeBookingSource } from "../move-actions";

const SOURCES: { value: string; label: string }[] = [
  { value: "DIRECT", label: "Direct" },
  { value: "WALK_IN", label: "Walk-in" },
  { value: "PHONE", label: "Phone / enquiry" },
  { value: "WEBSITE", label: "Website" },
  { value: "CORPORATE", label: "Corporate" },
  { value: "TRAVEL_AGENT", label: "Travel agent" },
  { value: "BOOKING_COM", label: "Booking.com" },
  { value: "MAKEMYTRIP", label: "MakeMyTrip" },
  { value: "AGODA", label: "Agoda" },
  { value: "GOIBIBO", label: "Goibibo" },
  { value: "AIRBNB", label: "Airbnb" },
];

export function ChangeSourceCard({ reservationId, currentSource }: { reservationId: string; currentSource: string }) {
  const router = useRouter();
  const [source, setSource] = useState(currentSource);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = () =>
    start(async () => {
      setError(null);
      const res = await changeBookingSource({ reservationId, source });
      if (res.ok) { setSaved(true); router.refresh(); setTimeout(() => setSaved(false), 2000); }
      else setError(res.error.message);
    });

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Booking source</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">Change the channel this booking is attributed to — e.g. an OTA guest who continues as a direct booking.</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1 space-y-1.5">
            <Label htmlFor="src">Source</Label>
            <select id="src" value={source} onChange={(e) => setSource(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="change-source-select">
              {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <Button disabled={pending || source === currentSource} onClick={save} data-testid="change-source-save">
            {pending ? "Saving…" : saved ? "Saved" : "Change source"}
          </Button>
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
