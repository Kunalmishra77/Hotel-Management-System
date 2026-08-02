"use client";

/**
 * Public booking widget — 23 T-18/T-19 (AC-1/4/6/13). Mobile-first: base styles
 * target the phone; everything is thumb-reachable. Talks ONLY to the public
 * `/api/booking-engine/v1/{slug}/*` route handlers — no server action, no auth.
 * Prices shown are GST-inclusive and equal what is charged (FR-15).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Category = {
  roomCategoryId: string;
  name: string;
  available: number;
  nights: number;
  totalPaise: number;
  depositPaise: number;
};

const rupees = (paise: number): string =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const CONSENT_VERSION = "2026-01-terms-v1";

export function BookingWidget({ slug, propertyName }: { slug: string; propertyName: string }): React.ReactElement {
  const today = new Date().toISOString().slice(0, 10);
  const [checkIn, setCheckIn] = useState(today);
  const [checkOut, setCheckOut] = useState(today);
  const [adults, setAdults] = useState(2);
  const [rooms, setRooms] = useState(1);
  const [results, setResults] = useState<Category[] | null>(null);
  const [selected, setSelected] = useState<Category | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Checkout form
  const [fullName, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [confirmation, setConfirmation] = useState<{ code: string; token: string; amountPaise: number } | null>(null);

  async function search(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ in: checkIn, out: checkOut, adults: String(adults), rooms: String(rooms) });
      const res = await fetch(`/api/booking-engine/v1/${slug}/availability?${qs}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Search failed.");
      setResults(body.data.categories);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  }

  async function book(): Promise<void> {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/booking-engine/v1/${slug}/hold`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          roomCategoryId: selected.roomCategoryId,
          checkInDate: checkIn,
          checkOutDate: checkOut,
          adults,
          rooms,
          guest: { fullName, mobile, email: email || undefined },
          consentAccepted: consent,
          consentVersion: CONSENT_VERSION,
          idempotencyKey: crypto.randomUUID(),
          honeypot: "",
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Booking failed.");
      setConfirmation({ code: body.data.reservationCode, token: body.data.selfServiceToken, amountPaise: body.data.amountPaise });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Booking failed.");
    } finally {
      setBusy(false);
    }
  }

  if (confirmation) {
    return (
      <Card>
        <CardHeader><CardTitle>Booking created</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>Your booking reference is <strong>{confirmation.code}</strong>.</p>
          <p>Complete the {rupees(confirmation.amountPaise)} deposit with the payment provider to confirm. You will receive a confirmation once payment is received.</p>
          <p className="break-all text-xs text-muted-foreground">Manage your booking: /book/{slug}/manage?t={confirmation.token}</p>
        </CardContent>
      </Card>
    );
  }

  if (selected) {
    return (
      <Card>
        <CardHeader><CardTitle>Your details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border p-3 text-sm">
            <div className="font-medium">{selected.name} · {selected.nights} night(s) · {rooms} room(s)</div>
            <div>{rupees(selected.totalPaise)} incl. GST · deposit {rupees(selected.depositPaise)}</div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="be-name">Name</Label>
            <Input id="be-name" value={fullName} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="be-mobile">Mobile</Label>
            <Input id="be-mobile" type="tel" inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} autoComplete="tel" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="be-email">Email (optional)</Label>
            <Input id="be-email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          {/* Honeypot: hidden from humans, filled by bots (FR-11). */}
          <input type="text" name="company_website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-5 w-5" />
            <span>I accept the terms and consent to my data being processed for this booking (DPDP).</span>
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setSelected(null); setError(null); }} className="flex-1">Back</Button>
            <Button onClick={book} disabled={busy || !consent || !fullName || !mobile} className="flex-1">
              Pay {rupees(selected.depositPaise)}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>{propertyName}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="be-in">Check-in</Label>
              <Input id="be-in" type="date" value={checkIn} min={today} onChange={(e) => setCheckIn(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="be-out">Check-out</Label>
              <Input id="be-out" type="date" value={checkOut} min={checkIn} onChange={(e) => setCheckOut(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="be-adults">Guests</Label>
              <Input id="be-adults" type="number" inputMode="numeric" min={1} value={adults} onChange={(e) => setAdults(Number(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="be-rooms">Rooms</Label>
              <Input id="be-rooms" type="number" inputMode="numeric" min={1} value={rooms} onChange={(e) => setRooms(Number(e.target.value))} />
            </div>
          </div>
          <Button onClick={search} disabled={busy} className="w-full">Search</Button>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {results && results.length === 0 && <p className="text-sm text-muted-foreground">No rooms available for those dates.</p>}
      {results?.map((c) => (
        <Card key={c.roomCategoryId}>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <div className="font-medium">{c.name}</div>
              <div className="text-sm">{rupees(c.totalPaise)} incl. GST · {c.nights}n</div>
              <div className="text-xs text-muted-foreground">{c.available} left</div>
            </div>
            <Button size="sm" onClick={() => { setSelected(c); setError(null); }}>Book</Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
