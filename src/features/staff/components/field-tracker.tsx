"use client";

/**
 * 09 addendum — the on-duty tracker a field-staff opens on their phone (FR-17).
 * Explicit consent before any capture; then the browser Geolocation API shares
 * location every few minutes to the public ping endpoint while this page stays
 * open. No map key, no login — just the tokened link. Closing the page ends it.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MapPin } from "lucide-react";

const PING_INTERVAL_MS = 3 * 60_000; // every 3 minutes while on-duty

export function FieldTracker({ token, staffName }: { token: string; staffName: string }) {
  const [sharing, setSharing] = useState(false);
  const [lastSentAt, setLastSentAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const lastSent = useRef<number>(0);

  async function send(lat: number, lng: number, accuracyM?: number) {
    try {
      const res = await fetch("/api/field-staff/ping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, lat, lng, accuracyM }),
        keepalive: true,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not share location.");
        return;
      }
      setError(null);
      setLastSentAt(new Date());
    } catch {
      setError("Network error while sharing location.");
    }
  }

  function start() {
    if (!("geolocation" in navigator)) {
      setError("This device does not support location sharing.");
      return;
    }
    setSharing(true);
    setError(null);
    // watchPosition keeps a fresh fix; we throttle the network send to the interval.
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastSent.current >= PING_INTERVAL_MS || lastSent.current === 0) {
          lastSent.current = now;
          void send(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        }
      },
      (err) => setError(err.code === err.PERMISSION_DENIED ? "Location permission denied." : "Could not get your location."),
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 30_000 },
    );
  }

  function stop() {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setSharing(false);
  }

  useEffect(() => () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary"><MapPin className="size-5" /></span>
        <div>
          <h1 className="text-lg font-semibold">On-duty tracker</h1>
          <p className="text-sm text-muted-foreground">{staffName}</p>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/30 p-4 text-sm">
        <p className="font-medium">Location sharing</p>
        <p className="mt-1 text-muted-foreground">
          While this page is open, your location is shared with your employer for on-duty dispatch and
          coordination. Close this page or tap Stop to end sharing.
        </p>
      </div>

      {error ? <p role="alert" className="text-sm text-destructive" data-testid="tracker-error">{error}</p> : null}

      {!sharing ? (
        <Button size="lg" className="w-full" onClick={start} data-testid="tracker-start">I consent — start sharing</Button>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-success/40 bg-success/5 p-4 text-sm">
            <p className="font-medium text-success">Sharing your location</p>
            <p className="mt-1 text-muted-foreground">
              {lastSentAt ? `Last shared at ${lastSentAt.toLocaleTimeString("en-IN")}` : "Getting your first location…"}
            </p>
          </div>
          <Button size="lg" variant="outline" className="w-full" onClick={stop} data-testid="tracker-stop">Stop sharing</Button>
        </div>
      )}
    </div>
  );
}
