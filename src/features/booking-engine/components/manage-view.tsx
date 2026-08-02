"use client";

/**
 * Self-service booking management — 23 T-16 (AC-15). No login: the signed token
 * from the query string authorizes access to this one booking. Status + windowed
 * cancel, via the public `/api/booking-engine/v1/{slug}/booking/{token}` route.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Status = {
  reservationCode: string;
  status: string;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  totalPaise: number;
  advancePaise: number;
  cancellable: boolean;
};

const rupees = (p: number): string => `₹${(p / 100).toLocaleString("en-IN")}`;

export function ManageView({ slug, token }: { slug: string; token: string }): React.ReactElement {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/booking-engine/v1/${slug}/booking/${encodeURIComponent(token)}`;

  useEffect(() => {
    void (async () => {
      const res = await fetch(base);
      const body = await res.json();
      if (res.ok) setStatus(body.data);
      else setError(body?.error?.message ?? "Booking not found.");
    })();
  }, [base]);

  async function cancel(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Cancellation failed.");
      setStatus((s) => (s ? { ...s, status: "CANCELLED", cancellable: false } : s));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancellation failed.");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!status) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <Card>
      <CardHeader><CardTitle>Booking {status.reservationCode}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>Status: <strong>{status.status}</strong></p>
        <p>{status.checkInDate.slice(0, 10)} → {status.checkOutDate.slice(0, 10)} · {status.nights} night(s)</p>
        <p>Total {rupees(status.totalPaise)} · Advance paid {rupees(status.advancePaise)}</p>
        {status.cancellable ? (
          <Button variant="destructive" onClick={cancel} disabled={busy} className="w-full">Cancel booking</Button>
        ) : (
          <p className="text-xs text-muted-foreground">This booking can no longer be cancelled online.</p>
        )}
      </CardContent>
    </Card>
  );
}
