"use client";
/**
 * Signed-in booking (Phase 2 T-5). Reuses the public availability API for search
 * (read-only), then books through the `createGuestBooking` server action — no
 * contact typing (identity is the session) and a real pay-now / at-hotel /
 * partial choice. Mobile-first.
 */
import { useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createGuestBooking, type GuestBookingResult } from "../booking-actions";

type Category = {
  roomCategoryId: string;
  name: string;
  available: number;
  nights: number;
  totalPaise: number;
  depositPaise: number;
  description?: string | null;
  amenities?: string[];
  imageUrls?: string[];
};

/** Room photo with a gradient fallback that always shows (broken/absent URL safe). */
function RoomImage({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  return (
    <div className={`relative overflow-hidden bg-gradient-to-br from-primary/20 to-primary/5 ${className ?? ""}`}>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      )}
    </div>
  );
}

function Amenities({ items }: { items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {items.slice(0, 5).map((a) => (
        <span key={a} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{a}</span>
      ))}
    </div>
  );
}

type Pref = "PAY_AT_HOTEL" | "PARTIAL" | "PAY_NOW";

const rupees = (paise: number): string =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** The last day free cancellation is allowed = check-in minus the window. */
function freeCancelBy(checkInStr: string, hours: number): string {
  const d = new Date(new Date(`${checkInStr}T00:00:00`).getTime() - hours * 3600 * 1000);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function GuestBooking({
  slug,
  propertyName,
  cancelWindowHours,
}: {
  slug: string;
  propertyName: string;
  cancelWindowHours?: number;
}): React.ReactElement {
  const today = new Date().toISOString().slice(0, 10);
  const [checkIn, setCheckIn] = useState(today);
  const [checkOut, setCheckOut] = useState(today);
  const [adults, setAdults] = useState(2);
  const [rooms, setRooms] = useState(1);
  const [results, setResults] = useState<Category[] | null>(null);
  const [selected, setSelected] = useState<Category | null>(null);
  const [pref, setPref] = useState<Pref>("PAY_AT_HOTEL");
  const [coupon, setCoupon] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<GuestBookingResult | null>(null);

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
    const res = await createGuestBooking({
      slug,
      roomCategoryId: selected.roomCategoryId,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      adults,
      rooms,
      paymentPreference: pref,
      couponCode: coupon.trim() || undefined,
      consentAccepted: consent,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setDone(res.data);
  }

  if (done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
            {done.confirmed ? "Booking confirmed" : "Booking created"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Your reference is <strong>{done.reservationCode}</strong>.
          </p>
          {done.confirmed ? (
            <p>You&apos;re all set — pay {rupees(done.totalPaise)} (incl. GST) at the hotel on arrival.</p>
          ) : (
            <p>
              Complete the {rupees(done.amountPaise)} payment to confirm. You&apos;ll get a confirmation once
              payment is received.
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild size="sm">
              <Link href="/account/bookings">View my bookings</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/account">Back to account</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (selected) {
    const amountFor: Record<Pref, number> = {
      PAY_AT_HOTEL: 0,
      PARTIAL: selected.depositPaise,
      PAY_NOW: selected.totalPaise,
    };
    const options: { key: Pref; title: string; sub: string }[] = [
      { key: "PAY_AT_HOTEL", title: "Pay at hotel", sub: "Nothing now — pay on arrival" },
      { key: "PARTIAL", title: `Pay deposit ${rupees(selected.depositPaise)}`, sub: "Balance at the hotel" },
      { key: "PAY_NOW", title: `Pay in full ${rupees(selected.totalPaise)}`, sub: "All done online" },
    ];

    return (
      <Card>
        <CardHeader>
          <CardTitle>Confirm your stay</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-hidden rounded-lg border">
            <RoomImage src={selected.imageUrls?.[0]} alt={selected.name} className="h-32 w-full" />
            <div className="p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{selected.name}</span>
                <span className="font-semibold">{rupees(selected.totalPaise)}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {selected.nights} night(s) · {rooms} room(s) · incl. GST
              </div>
              <Amenities items={selected.amenities} />
            </div>
          </div>

          {/* Coupon */}
          <div className="space-y-1.5">
            <Label htmlFor="gb-coupon">Coupon code (optional)</Label>
            <Input id="gb-coupon" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="e.g. WELCOME10" />
            {coupon.trim() && <p className="text-xs text-muted-foreground">Applied at confirmation — your final total reflects any valid discount.</p>}
          </div>

          {/* Cancellation policy */}
          {cancelWindowHours != null && (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              ✓ Free cancellation until {freeCancelBy(checkIn, cancelWindowHours)}.
            </p>
          )}

          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">How would you like to pay?</legend>
            {options.map((o) => (
              <label
                key={o.key}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
              >
                <input
                  type="radio"
                  name="pref"
                  className="mt-1 h-4 w-4"
                  checked={pref === o.key}
                  onChange={() => setPref(o.key)}
                />
                <span>
                  <span className="font-medium">{o.title}</span>
                  <span className="block text-xs text-muted-foreground">{o.sub}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-1 h-5 w-5"
            />
            <span>I accept the terms and consent to my data being processed for this booking (DPDP).</span>
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setSelected(null);
                setError(null);
              }}
              className="flex-1"
            >
              Back
            </Button>
            <Button onClick={book} disabled={busy || !consent} className="flex-1">
              {busy
                ? "Booking…"
                : pref === "PAY_AT_HOTEL"
                  ? "Confirm booking"
                  : `Pay ${rupees(amountFor[pref])}`}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{propertyName}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="gb-in">Check-in</Label>
              <Input id="gb-in" type="date" value={checkIn} min={today} onChange={(e) => setCheckIn(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gb-out">Check-out</Label>
              <Input id="gb-out" type="date" value={checkOut} min={checkIn} onChange={(e) => setCheckOut(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gb-adults">Guests</Label>
              <Input id="gb-adults" type="number" inputMode="numeric" min={1} value={adults} onChange={(e) => setAdults(Number(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gb-rooms">Rooms</Label>
              <Input id="gb-rooms" type="number" inputMode="numeric" min={1} value={rooms} onChange={(e) => setRooms(Number(e.target.value))} />
            </div>
          </div>
          <Button onClick={search} disabled={busy} className="w-full">
            {busy ? "Searching…" : "Search availability"}
          </Button>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {results && results.length === 0 && (
        <p className="text-sm text-muted-foreground">No rooms available for those dates.</p>
      )}
      {results?.map((c) => (
        <Card key={c.roomCategoryId} className="overflow-hidden">
          <RoomImage src={c.imageUrls?.[0]} alt={c.name} className="h-40 w-full" />
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold">{c.name}</div>
                <div className="text-xs text-muted-foreground">{c.available} left for your dates</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-semibold">{rupees(c.totalPaise)}</div>
                <div className="text-[11px] text-muted-foreground">incl. GST · {c.nights}n</div>
              </div>
            </div>
            {c.description && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{c.description}</p>}
            <Amenities items={c.amenities} />
            <Button size="sm" className="mt-3 w-full" onClick={() => { setSelected(c); setPref("PAY_AT_HOTEL"); setError(null); }}>
              Select this room
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
