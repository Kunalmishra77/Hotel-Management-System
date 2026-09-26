"use client";

/**
 * Booking stepper — 03 T-28 (AC-1/2/4). Dates+occupancy → pick a free room →
 * pick the guest → amounts, with a LIVE bill preview that recomputes on every
 * change via the same `priceReservation` the server uses (one definition of the
 * money). Mobile-first: numeric keypads, ≥44px actions. Amounts are entered in ₹
 * and submitted as integer paise in hidden fields.
 */
import { useState, useTransition, useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { roomGstBps, gstBpsForCharge } from "@/lib/constants/gst";
import { nights as computeNights } from "../domain/nights";
import { searchAvailability } from "../availability-action";
import {
  createGuestForBooking,
  createReservationFormAction,
  searchGuestsForBooking,
  type BookingFormState,
  type GuestPick,
} from "../form-actions";
import type { AvailableRoom } from "../availability";

type Category = { id: string; name: string; propertyId: string };
type PropertyOpt = { id: string; name: string; timezone: string };
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;
const toPaise = (r: number) => Math.round(r * 100);
const INITIAL: BookingFormState = { status: "idle" };

export function BookingForm({
  properties,
  categories,
  defaultPropertyId,
}: {
  properties: PropertyOpt[];
  categories: Category[];
  defaultPropertyId: string;
}) {
  const [propertyId, setPropertyId] = useState(defaultPropertyId);
  const propertyCategories = categories.filter((c) => c.propertyId === propertyId);
  const timezone = properties.find((p) => p.id === propertyId)?.timezone ?? "Asia/Kolkata";
  const [checkInDate, setCheckIn] = useState("");
  const [checkOutDate, setCheckOut] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [categoryId, setCategoryId] = useState(propertyCategories[0]?.id ?? "");
  const [rooms, setRooms] = useState<AvailableRoom[] | null>(null);
  // Multi-room: a guest can book a single room OR the whole 2/3 BHK unit (all rooms).
  const [selectedRooms, setSelectedRooms] = useState<AvailableRoom[]>([]);
  const [rateTouched, setRateTouched] = useState(false);
  const [searching, startSearch] = useTransition();

  // Switching property resets the property-dependent picks.
  function onPropertyChange(pid: string) {
    setPropertyId(pid);
    const firstCat = categories.find((c) => c.propertyId === pid);
    setCategoryId(firstCat?.id ?? "");
    setRooms(null);
    setSelectedRooms([]);
    setRateTouched(false);
  }

  // Default the nightly rate to the SUM of the selected rooms' base rates (the whole
  // unit costs the sum of its rooms) until the user overrides it.
  function applySelection(next: AvailableRoom[]) {
    setSelectedRooms(next);
    if (!rateTouched) {
      const sum = next.reduce((n, r) => n + r.baseRatePaise, 0);
      setRate(sum / 100);
    }
  }
  const toggleRoom = (r: AvailableRoom) => {
    const has = selectedRooms.some((x) => x.id === r.id);
    applySelection(has ? selectedRooms.filter((x) => x.id !== r.id) : [...selectedRooms, r]);
  };
  const selectAll = () => applySelection(rooms ?? []);
  const isSelected = (id: string) => selectedRooms.some((x) => x.id === id);

  const [source, setSource] = useState("WALK_IN");
  const isOta = ["BOOKING_COM", "MAKEMYTRIP", "AGODA", "GOIBIBO", "AIRBNB", "TRAVEL_AGENT"].includes(source);
  const [settlement, setSettlement] = useState("PAY_AT_HOTEL");
  const [guestQuery, setGuestQuery] = useState("");
  const [guests, setGuests] = useState<GuestPick[]>([]);
  const [guest, setGuest] = useState<GuestPick | null>(null);
  const [, startGuestSearch] = useTransition();

  // Inline "new guest" (walk-in) mode.
  const [newGuest, setNewGuest] = useState(false);
  const [ngName, setNgName] = useState("");
  const [ngMobile, setNgMobile] = useState("");
  const [ngCity, setNgCity] = useState("");
  const [ngErr, setNgErr] = useState<string | null>(null);
  const [creatingGuest, startCreateGuest] = useTransition();

  const createNewGuest = () =>
    startCreateGuest(async () => {
      setNgErr(null);
      const r = await createGuestForBooking({
        fullName: ngName.trim(),
        mobile: ngMobile.trim(),
        city: ngCity.trim() || undefined,
      });
      if (r.ok) {
        setGuest(r.guest);
        setNewGuest(false);
      } else {
        setNgErr(r.message);
      }
    });

  const [rate, setRate] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [extraBed, setExtraBed] = useState(0);
  const [advance, setAdvance] = useState(0);
  const [gstInclusive, setGstInclusive] = useState(false);

  const [state, submit, pending] = useActionState(createReservationFormAction, INITIAL);

  const nights =
    checkInDate && checkOutDate
      ? computeNights(new Date(`${checkInDate}T00:00:00Z`), new Date(`${checkOutDate}T00:00:00Z`), timezone)
      : 0;

  // GST inclusive vs exclusive (mirrors Data Entry). "Inclusive" → the rate the
  // receptionist typed already contains GST, so we back out the pre-tax value we
  // submit (the server/night-audit adds GST from the band → total = what was
  // typed). "Exclusive" → the rate is pre-tax and GST is added on top. 06 owns the
  // authoritative GST; this is the out-the-door preview.
  const EB_BPS = gstBpsForCharge("EXTRA_BED"); // extra bed GST, config-driven (flat 5%)
  const roomBps = roomGstBps(toPaise(rate) || 1);
  const toTaxable = (enteredPaise: number, bps: number) =>
    gstInclusive ? Math.round((enteredPaise * 10_000) / (10_000 + bps)) : enteredPaise;
  const ratePaiseSubmit = toTaxable(toPaise(rate), roomBps);
  const extraBedPaiseSubmit = toTaxable(toPaise(extraBed), EB_BPS);
  const discountPaise = toPaise(discount);
  const advancePaise = toPaise(advance);
  const roomTaxable = ratePaiseSubmit * nights;
  const roomGst = Math.round((roomTaxable * roomBps) / 10_000);
  const ebGst = Math.round((extraBedPaiseSubmit * EB_BPS) / 10_000);
  const taxPaise = roomGst + ebGst;
  const totalPaise = roomTaxable + extraBedPaiseSubmit + taxPaise - discountPaise;
  const balancePaise = totalPaise - advancePaise;
  const roomEnteredPaise = toPaise(rate) * nights; // what reception typed (all-in if inclusive)

  const runSearch = () => {
    startSearch(async () => {
      setSelectedRooms([]);
      setRateTouched(false);
      const res = await searchAvailability({ propertyId, checkInDate, checkOutDate, categoryId, adults, children });
      setRooms(res.ok ? res.data.rooms : []);
    });
  };

  const runGuestSearch = (q: string) => {
    setGuestQuery(q);
    startGuestSearch(async () => setGuests(await searchGuestsForBooking(q)));
  };

  return (
    <form action={submit} className="space-y-4" data-testid="booking-form">
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="checkInDate" value={checkInDate} />
      <input type="hidden" name="checkOutDate" value={checkOutDate} />
      <input type="hidden" name="adults" value={adults} />
      <input type="hidden" name="children" value={children} />
      <input type="hidden" name="roomIds" value={selectedRooms.map((r) => r.id).join(",")} />
      <input type="hidden" name="guestId" value={guest?.id ?? ""} />
      <input type="hidden" name="ratePaise" value={ratePaiseSubmit} />
      <input type="hidden" name="discountPaise" value={discountPaise} />
      <input type="hidden" name="extraBedPaise" value={extraBedPaiseSubmit} />
      <input type="hidden" name="taxPaise" value={taxPaise} />
      <input type="hidden" name="advancePaise" value={advancePaise} />

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Property, dates & occupancy</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Labeled label="Property">
            <select value={propertyId} onChange={(e) => onPropertyChange(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="property-select">
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Labeled>
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Check-in"><Input type="date" value={checkInDate} onChange={(e) => setCheckIn(e.target.value)} data-testid="checkin-date" /></Labeled>
            <Labeled label="Check-out"><Input type="date" value={checkOutDate} onChange={(e) => setCheckOut(e.target.value)} data-testid="checkout-date" /></Labeled>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Labeled label="Adults"><Input type="number" inputMode="numeric" min={1} value={adults} onChange={(e) => setAdults(Number(e.target.value))} /></Labeled>
            <Labeled label="Children"><Input type="number" inputMode="numeric" min={0} value={children} onChange={(e) => setChildren(Number(e.target.value))} /></Labeled>
            <Labeled label="Room category">
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="category-select">
                {propertyCategories.length === 0 ? <option value="">No categories</option> : null}
                {propertyCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Labeled>
          </div>
          <Labeled label="Booking source">
            <select
              name="source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="WALK_IN">Walk-in</option>
              <option value="DIRECT">Direct</option>
              <option value="PHONE">Phone / enquiry</option>
              <option value="CORPORATE">Corporate</option>
              <option value="BOOKING_COM">Booking.com</option>
              <option value="MAKEMYTRIP">MakeMyTrip</option>
              <option value="AGODA">Agoda</option>
              <option value="GOIBIBO">Goibibo</option>
              <option value="AIRBNB">Airbnb</option>
              <option value="TRAVEL_AGENT">Travel agent</option>
            </select>
          </Labeled>
          <Button type="button" size="lg" block disabled={!checkInDate || !checkOutDate || searching} onClick={runSearch} data-testid="check-availability">
            {searching ? "Checking…" : "Check availability"}
          </Button>
        </CardContent>
      </Card>

      {rooms !== null && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Free rooms</CardTitle>
          </CardHeader>
          <CardContent>
            {rooms.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="no-availability">No rooms free for those dates.</p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Tap a room to book it. Tap more than one — or use <b>Book the whole unit</b> — to book the full {rooms.length}-room ({rooms.length} BHK) apartment together.
                </p>
                <ul className="space-y-2" data-testid="room-options">
                  {rooms.map((r) => (
                    <li key={r.id}>
                      <Button type="button" block variant={isSelected(r.id) ? "default" : "outline"} size="lg"
                        onClick={() => toggleRoom(r)}
                        data-testid={`room-option-${r.number}`}>
                        {isSelected(r.id) ? "✓ " : ""}{r.number} · {r.categoryName} · {rupees(r.baseRatePaise)}/night
                      </Button>
                    </li>
                  ))}
                </ul>
                {rooms.length > 1 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={selectAll} data-testid="book-whole-unit">
                      Book the whole unit ({rooms.length} BHK — all {rooms.length} rooms)
                    </Button>
                    {selectedRooms.length > 0 && (
                      <button type="button" className="text-xs text-muted-foreground underline" onClick={() => applySelection([])}>Clear</button>
                    )}
                  </div>
                )}
                {selectedRooms.length > 0 && (
                  <p className="rounded-md border bg-muted/40 p-2 text-sm" data-testid="rooms-selected">
                    {selectedRooms.length === 1
                      ? `1 room selected · ${selectedRooms[0]!.number}`
                      : `${selectedRooms.length} rooms selected (whole unit) · ${selectedRooms.map((r) => r.number).join(", ")}`}
                    {" · "}<span className="font-medium">{rupees(selectedRooms.reduce((n, r) => n + r.baseRatePaise, 0))}/night</span>
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {selectedRooms.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Guest</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {guest ? (
              <p className="rounded-md border bg-muted/40 p-3 text-sm" data-testid="selected-guest">
                {guest.name} · {guest.maskedMobile ?? "—"}{" "}
                <button type="button" className="text-primary underline" onClick={() => setGuest(null)}>change</button>
              </p>
            ) : newGuest ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Labeled label="Full name">
                    <Input value={ngName} onChange={(e) => setNgName(e.target.value)} placeholder="Guest name" data-testid="new-guest-name" />
                  </Labeled>
                  <Labeled label="Mobile">
                    <Input inputMode="tel" value={ngMobile} onChange={(e) => setNgMobile(e.target.value)} placeholder="98xxxxxxxx" data-testid="new-guest-mobile" />
                  </Labeled>
                  <Labeled label="City">
                    <Input value={ngCity} onChange={(e) => setNgCity(e.target.value)} placeholder="City" />
                  </Labeled>
                </div>
                {ngErr && <p role="alert" className="text-sm text-destructive">{ngErr}</p>}
                <div className="flex gap-2">
                  <Button type="button" disabled={!ngName.trim() || !ngMobile.trim() || creatingGuest} onClick={createNewGuest} data-testid="create-guest">
                    {creatingGuest ? "Creating…" : "Create & select"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => { setNewGuest(false); setNgErr(null); }}>
                    Back to search
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <Input value={guestQuery} onChange={(e) => runGuestSearch(e.target.value)}
                  placeholder="Search guest by name or mobile" data-testid="guest-search" />
                <ul className="divide-y rounded-md border">
                  {guests.map((g) => (
                    <li key={g.id}>
                      <button type="button" onClick={() => setGuest(g)}
                        className="flex min-h-11 w-full items-center justify-between p-3 text-left hover:bg-muted/50"
                        data-testid={`guest-pick-${g.id}`}>
                        <span>{g.name}</span><span className="text-sm text-muted-foreground">{g.maskedMobile ?? "—"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <Button type="button" variant="outline" size="sm" onClick={() => setNewGuest(true)} data-testid="new-guest">
                  + New guest (walk-in)
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {selectedRooms.length > 0 && guest && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Charges</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Labeled label="GST on the rate you enter">
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name="gstMode" checked={!gstInclusive} onChange={() => setGstInclusive(false)} data-testid="gst-exclusive" /> Add GST on top
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="gstMode" checked={gstInclusive} onChange={() => setGstInclusive(true)} data-testid="gst-inclusive" /> Price includes GST
                </label>
              </div>
            </Labeled>
            <div className="grid gap-3 sm:grid-cols-2">
              <Labeled label="Rate/night (₹)">
                <Input type="number" inputMode="numeric" value={rate} onChange={(e) => { setRateTouched(true); setRate(Number(e.target.value)); }} data-testid="rate" />
                {isOta && (
                  <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400" data-testid="ota-rate-hint">
                    OTA booking — enter the agreed {source === "MAKEMYTRIP" ? "MakeMyTrip" : source === "BOOKING_COM" ? "Booking.com" : "channel"} rate here, not the default room rate.
                  </p>
                )}
              </Labeled>
              <Labeled label="Discount (₹)"><Input type="number" inputMode="numeric" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} /></Labeled>
              <Labeled label="Extra bed (₹)"><Input type="number" inputMode="numeric" value={extraBed} onChange={(e) => setExtraBed(Number(e.target.value))} /></Labeled>
              <Labeled label="Advance (₹)"><Input type="number" inputMode="numeric" value={advance} onChange={(e) => setAdvance(Number(e.target.value))} data-testid="advance" /></Labeled>
            </div>
            <Labeled label="Payment status">
              <select
                name="settlementIntent"
                value={settlement}
                onChange={(e) => setSettlement(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                data-testid="settlement-intent"
              >
                <option value="PAY_AT_HOTEL">Pay at hotel</option>
                <option value="ALREADY_PAID">Already paid</option>
                <option value="UNPAID_ONLINE">Unpaid (online link)</option>
              </select>
            </Labeled>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="extraBed" className="size-4" /> Extra bed override (exceeds category occupancy)
            </label>

            <Labeled label="Notes / special requests">
              <Textarea name="notes" placeholder="ETA, preferences, ID pending, VIP…" data-testid="booking-notes" />
            </Labeled>

            <dl className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm" data-testid="bill-preview">
              <Row label={`Room (${nights} × ${rupees(toPaise(rate))})`} value={rupees(roomEnteredPaise)} />
              <Row label="Discount" value={`− ${rupees(discountPaise)}`} />
              <Row label="Extra bed" value={`+ ${rupees(toPaise(extraBed))}`} />
              <Row label={gstInclusive ? "GST (included)" : "GST"} value={gstInclusive ? `incl. ${rupees(taxPaise)}` : `+ ${rupees(taxPaise)}`} />
              <Row label="Total" value={rupees(totalPaise)} strong testid="bill-total" />
              <Row label="Advance" value={`− ${rupees(advancePaise)}`} />
              <Row label="Balance due" value={rupees(balancePaise)} strong testid="bill-balance" />
            </dl>
          </CardContent>
        </Card>
      )}

      {state.status === "error" && <p role="alert" className="text-sm text-destructive">{state.message}</p>}

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" size="lg" className="sm:min-w-40" disabled={selectedRooms.length === 0 || !guest || pending} data-testid="confirm-booking">
          {pending ? "Confirming…" : "Confirm booking"}
        </Button>
        <Button
          type="submit"
          name="checkInNow"
          value="true"
          variant="secondary"
          size="lg"
          disabled={selectedRooms.length === 0 || !guest || pending}
          data-testid="confirm-checkin-now"
        >
          Book &amp; check in now
        </Button>
        <Button asChild variant="outline" size="lg"><Link href="/bookings">Cancel</Link></Button>
      </div>
    </form>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
function Row({ label, value, strong, testid }: { label: string; value: string; strong?: boolean; testid?: string }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold" : ""}`}>
      <dt>{label}</dt><dd data-testid={testid}>{value}</dd>
    </div>
  );
}
