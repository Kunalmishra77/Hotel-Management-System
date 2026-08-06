"use client";

/**
 * Booking stepper — 03 T-28 (AC-1/2/4). Dates+occupancy → pick a free room →
 * pick the guest → amounts, with a LIVE bill preview that recomputes on every
 * change via the same `priceReservation` the server uses (one definition of the
 * money). Mobile-first: numeric keypads, ≥44px actions. Amounts are entered in ₹
 * and submitted as integer paise in hidden fields.
 */
import { useMemo, useState, useTransition, useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { priceReservation } from "../domain/pricing";
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

type Category = { id: string; name: string };
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;
const toPaise = (r: number) => Math.round(r * 100);
const INITIAL: BookingFormState = { status: "idle" };

export function BookingForm({
  propertyId,
  categories,
  timezone,
}: {
  propertyId: string;
  categories: Category[];
  timezone: string;
}) {
  const [checkInDate, setCheckIn] = useState("");
  const [checkOutDate, setCheckOut] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [rooms, setRooms] = useState<AvailableRoom[] | null>(null);
  const [room, setRoom] = useState<AvailableRoom | null>(null);
  const [searching, startSearch] = useTransition();

  const [source, setSource] = useState("WALK_IN");
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

  const [state, submit, pending] = useActionState(createReservationFormAction, INITIAL);

  const nights =
    checkInDate && checkOutDate
      ? computeNights(new Date(`${checkInDate}T00:00:00Z`), new Date(`${checkOutDate}T00:00:00Z`), timezone)
      : 0;

  // Deluxe/Suite GST is 12% here; 06 owns the authoritative GST — this is the
  // preview estimate so the receptionist sees the out-the-door number.
  const taxable = toPaise(rate) * nights - toPaise(discount) + toPaise(extraBed);
  const taxPaise = Math.round(Math.max(0, taxable) * 0.12);
  const bill = useMemo(
    () =>
      priceReservation({
        ratePaise: toPaise(rate),
        nights: Math.max(1, nights),
        discountPaise: toPaise(discount),
        extraBedPaise: toPaise(extraBed),
        taxPaise,
        advancePaise: toPaise(advance),
      }),
    [rate, nights, discount, extraBed, taxPaise, advance],
  );

  const runSearch = () => {
    startSearch(async () => {
      setRoom(null);
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
      <input type="hidden" name="roomId" value={room?.id ?? ""} />
      <input type="hidden" name="guestId" value={guest?.id ?? ""} />
      <input type="hidden" name="ratePaise" value={toPaise(rate)} />
      <input type="hidden" name="discountPaise" value={toPaise(discount)} />
      <input type="hidden" name="extraBedPaise" value={toPaise(extraBed)} />
      <input type="hidden" name="taxPaise" value={taxPaise} />
      <input type="hidden" name="advancePaise" value={toPaise(advance)} />

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Dates & occupancy</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Check-in"><Input type="date" value={checkInDate} onChange={(e) => setCheckIn(e.target.value)} data-testid="checkin-date" /></Labeled>
            <Labeled label="Check-out"><Input type="date" value={checkOutDate} onChange={(e) => setCheckOut(e.target.value)} data-testid="checkout-date" /></Labeled>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Labeled label="Adults"><Input type="number" inputMode="numeric" min={1} value={adults} onChange={(e) => setAdults(Number(e.target.value))} /></Labeled>
            <Labeled label="Children"><Input type="number" inputMode="numeric" min={0} value={children} onChange={(e) => setChildren(Number(e.target.value))} /></Labeled>
            <Labeled label="Category">
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="category-select">
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
            </select>
          </Labeled>
          <Button type="button" size="lg" block disabled={!checkInDate || !checkOutDate || searching} onClick={runSearch} data-testid="check-availability">
            {searching ? "Checking…" : "Check availability"}
          </Button>
        </CardContent>
      </Card>

      {rooms !== null && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Free rooms</CardTitle></CardHeader>
          <CardContent>
            {rooms.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="no-availability">No rooms free for those dates.</p>
            ) : (
              <ul className="space-y-2" data-testid="room-options">
                {rooms.map((r) => (
                  <li key={r.id}>
                    <Button type="button" block variant={room?.id === r.id ? "default" : "outline"} size="lg"
                      onClick={() => { setRoom(r); setRate(r.baseRatePaise / 100); }}
                      data-testid={`room-option-${r.number}`}>
                      {r.number} · {r.categoryName} · {rupees(r.baseRatePaise)}/night
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {room && (
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

      {room && guest && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Charges</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Labeled label="Rate/night (₹)"><Input type="number" inputMode="numeric" value={rate} onChange={(e) => setRate(Number(e.target.value))} data-testid="rate" /></Labeled>
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
              <Row label={`Room (${nights} × ${rupees(toPaise(rate))})`} value={rupees(bill.breakdown.roomPaise)} />
              <Row label="Discount" value={`− ${rupees(bill.breakdown.discountPaise)}`} />
              <Row label="Extra bed" value={`+ ${rupees(bill.breakdown.extraBedPaise)}`} />
              <Row label="Tax (est. 12%)" value={`+ ${rupees(taxPaise)}`} />
              <Row label="Total" value={rupees(bill.totalPaise)} strong testid="bill-total" />
              <Row label="Advance" value={`− ${rupees(bill.breakdown.advancePaise)}`} />
              <Row label="Balance due" value={rupees(bill.balancePaise)} strong testid="bill-balance" />
            </dl>
          </CardContent>
        </Card>
      )}

      {state.status === "error" && <p role="alert" className="text-sm text-destructive">{state.message}</p>}

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" size="lg" className="sm:min-w-40" disabled={!room || !guest || pending} data-testid="confirm-booking">
          {pending ? "Confirming…" : "Confirm booking"}
        </Button>
        <Button
          type="submit"
          name="checkInNow"
          value="true"
          variant="secondary"
          size="lg"
          disabled={!room || !guest || pending}
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
