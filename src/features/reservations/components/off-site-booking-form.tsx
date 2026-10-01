"use client";

/**
 * #1 — "Other" (off-site) booking form. Records a stay at a property Woodpecker
 * does NOT run: just the guest, dates, hotel name + address and an optional
 * amount. No room selection / availability / folio. Owned by a real property for
 * scope. Guest search/create reuse the normal booking pickers.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createExternalStay } from "../actions";
import { createGuestForBooking, searchGuestsForBooking, type GuestPick } from "../form-actions";

type PropertyOpt = { id: string; name: string };
const toPaise = (r: number) => Math.round(r * 100);

export function OffSiteBookingForm({ properties, defaultPropertyId }: { properties: PropertyOpt[]; defaultPropertyId: string }) {
  const router = useRouter();
  const [propertyId, setPropertyId] = useState(defaultPropertyId);
  const [hotelName, setHotelName] = useState("");
  const [hotelAddress, setHotelAddress] = useState("");
  const [checkInDate, setCheckIn] = useState("");
  const [checkOutDate, setCheckOut] = useState("");
  const [source, setSource] = useState("DIRECT");
  const [amount, setAmount] = useState(0);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const [guestQuery, setGuestQuery] = useState("");
  const [guests, setGuests] = useState<GuestPick[]>([]);
  const [guest, setGuest] = useState<GuestPick | null>(null);
  const [, startGuestSearch] = useTransition();
  const [newGuest, setNewGuest] = useState(false);
  const [ngName, setNgName] = useState("");
  const [ngMobile, setNgMobile] = useState("");
  const [ngErr, setNgErr] = useState<string | null>(null);
  const [creatingGuest, startCreateGuest] = useTransition();

  const todayStr = new Date().toLocaleDateString("en-CA");
  const selectCls = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

  const runGuestSearch = (q: string) => {
    setGuestQuery(q);
    startGuestSearch(async () => setGuests(await searchGuestsForBooking(q)));
  };
  const createNewGuest = () =>
    startCreateGuest(async () => {
      setNgErr(null);
      const r = await createGuestForBooking({ fullName: ngName.trim(), mobile: ngMobile.trim() });
      if (r.ok) { setGuest(r.guest); setNewGuest(false); } else setNgErr(r.message);
    });

  const canSubmit = !!propertyId && !!guest && !!hotelName.trim() && !!hotelAddress.trim() && !!checkInDate && !!checkOutDate && !pending;

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await createExternalStay({
        propertyId,
        guestId: guest!.id,
        source,
        externalHotelName: hotelName.trim(),
        externalHotelAddress: hotelAddress.trim(),
        checkInDate,
        checkOutDate,
        amountPaise: toPaise(amount),
        notes: notes.trim() || undefined,
      });
      if (res.ok) router.push(`/bookings/${res.data.id}`);
      else setError(res.error.message);
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Off-site property</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Recording a stay the guest is booking at a hotel we don&apos;t run (e.g. a referral or an overflow). Only the hotel name + address are stored — no room or availability is used.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="osb-prop">Record under property</Label>
            <select id="osb-prop" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className={selectCls}>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="osb-name">Hotel / property name</Label>
            <Input id="osb-name" value={hotelName} onChange={(e) => setHotelName(e.target.value)} placeholder="e.g. Hotel Sunrise" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="osb-addr">Hotel address</Label>
            <Textarea id="osb-addr" value={hotelAddress} onChange={(e) => setHotelAddress(e.target.value)} placeholder="Full address" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="osb-in">Check-in</Label><Input id="osb-in" type="date" min={todayStr} value={checkInDate} onChange={(e) => { const v = e.target.value; setCheckIn(v); if (checkOutDate && v && checkOutDate <= v) setCheckOut(""); }} /></div>
            <div className="space-y-1.5"><Label htmlFor="osb-out">Check-out</Label><Input id="osb-out" type="date" min={checkInDate || todayStr} value={checkOutDate} onChange={(e) => setCheckOut(e.target.value)} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="osb-src">Booking source</Label>
              <select id="osb-src" value={source} onChange={(e) => setSource(e.target.value)} className={selectCls}>
                <option value="DIRECT">Direct</option>
                <option value="PHONE">Phone</option>
                <option value="WALK_IN">Walk-in</option>
                <option value="CORPORATE">Corporate</option>
                <option value="TRAVEL_AGENT">Travel agent</option>
              </select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="osb-amt">Amount (₹) <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="osb-amt" type="number" inputMode="decimal" step="0.01" value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} /></div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="osb-notes">Notes <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id="osb-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any detail about this off-site booking" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Guest</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {guest ? (
            <p className="rounded-md border bg-muted/40 p-3 text-sm">
              {guest.name} · {guest.maskedMobile ?? "—"}{" "}
              <button type="button" className="text-primary underline" onClick={() => setGuest(null)}>change</button>
            </p>
          ) : newGuest ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>Full name</Label><Input value={ngName} onChange={(e) => setNgName(e.target.value)} placeholder="Guest name" /></div>
                <div className="space-y-1.5"><Label>Mobile</Label><Input inputMode="tel" value={ngMobile} onChange={(e) => setNgMobile(e.target.value)} placeholder="98xxxxxxxx" /></div>
              </div>
              {ngErr && <p role="alert" className="text-sm text-destructive">{ngErr}</p>}
              <div className="flex gap-2">
                <Button type="button" disabled={!ngName.trim() || !ngMobile.trim() || creatingGuest} onClick={createNewGuest}>{creatingGuest ? "Creating…" : "Create & select"}</Button>
                <Button type="button" variant="ghost" onClick={() => { setNewGuest(false); setNgErr(null); }}>Back to search</Button>
              </div>
            </div>
          ) : (
            <>
              <Input value={guestQuery} onChange={(e) => runGuestSearch(e.target.value)} placeholder="Search guest by name or mobile" />
              <ul className="divide-y rounded-md border">
                {guests.map((g) => (
                  <li key={g.id}>
                    <button type="button" onClick={() => setGuest(g)} className="flex min-h-11 w-full items-center justify-between p-3 text-left hover:bg-muted/50">
                      <span>{g.name}</span><span className="text-sm text-muted-foreground">{g.maskedMobile ?? "—"}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <Button type="button" variant="outline" size="sm" onClick={() => setNewGuest(true)}>+ New guest</Button>
            </>
          )}
        </CardContent>
      </Card>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button size="lg" className="sm:min-w-40" disabled={!canSubmit} onClick={submit}>{pending ? "Saving…" : "Record off-site stay"}</Button>
        <Button asChild variant="outline" size="lg"><Link href="/bookings/new">Back to booking</Link></Button>
      </div>
    </div>
  );
}
