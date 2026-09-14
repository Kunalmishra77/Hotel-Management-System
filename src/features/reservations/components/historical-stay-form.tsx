"use client";

/**
 * Historical stay entry (go-live data onboarding). The manager records each past
 * guest stay for a property: guest details + ID + the compulsory Property /
 * Check-in / Check-out, and optionally the tariff & amount collected. On save it
 * creates a CHECKED_OUT reservation with a folio + bill, so the stay flows into
 * guest history, occupancy and revenue for that property and dates. The form
 * keeps the property selected and clears the rest after each save for fast
 * repeated entry.
 */
import { useEffect, useState, useTransition } from "react";
import { CalendarClock, IdCard, Receipt, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { COUNTRIES } from "@/lib/constants/countries";
import { createHistoricalStay } from "../historical-actions";

/** Dial code for a country name (auto-fills the mobile prefix). India by default. */
function dialFor(country: string): string {
  return COUNTRIES.find((c) => c.name === country)?.dial ?? "+91";
}

type Property = { id: string; name: string };
type Room = { id: string; propertyId: string; label: string; ratePaise: number };
const ID_TYPES = ["", "AADHAAR", "PASSPORT", "DRIVING_LICENCE", "VOTER_ID", "PAN", "VISA"] as const;

const blank = {
  fullName: "", mobile: "", email: "", gender: "", nationality: "",
  address: "", city: "", country: "India", dob: "",
  checkInDate: "", checkOutDate: "", idType: "", idNumber: "", rate: "", paid: "",
  gstMode: "inclusive", // "inclusive" (rate incl. GST) | "exclusive" (add GST on top)
};

type Person = { fullName: string; age: string; gender: string; relation: string; idType: string; idNumber: string };
const blankPerson: Person = { fullName: "", age: "", gender: "", relation: "", idType: "", idNumber: "" };
const ID_OPTS = ["", "AADHAAR", "PASSPORT", "DRIVING_LICENCE", "VOTER_ID", "PAN", "VISA"] as const;

// Extra services on the same bill (meals, laundry, cab…).
type Extra = { type: string; description: string; amount: string };
const blankExtra: Extra = { type: "FOOD", description: "", amount: "" };
const CHARGE_TYPES = ["FOOD", "LAUNDRY", "AIRPORT_TRANSFER", "TAXI", "EXTRA_BED", "MISC"] as const;
const CHARGE_LABEL: Record<string, string> = {
  FOOD: "Food / Meals", LAUNDRY: "Laundry", AIRPORT_TRANSFER: "Airport transfer",
  TAXI: "Taxi / Cab", EXTRA_BED: "Extra bed", MISC: "Other",
};

// Auto-saved draft: what the staff typed survives switching tabs / leaving the
// page and coming back. The uploaded photo is intentionally NOT kept (it can be
// several MB — too big for localStorage); everything typed is. Bump the version
// suffix if the shape below ever changes.
const DRAFT_KEY = "wp-data-entry-draft-v1";
type Draft = { propertyId: string; roomId: string; f: typeof blank; people: Person[]; extras: Extra[] };

function fileToParts(file: File): Promise<{ base64: string; contentType: string; preview: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      resolve({ base64: url.split(",")[1] ?? "", contentType: file.type || "image/jpeg", preview: url });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function HistoricalStayForm({ properties, rooms }: { properties: Property[]; rooms: Room[] }) {
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [roomId, setRoomId] = useState("");
  const [f, setF] = useState({ ...blank });
  const [people, setPeople] = useState<Person[]>([]);
  const [extras, setExtras] = useState<Extra[]>([]);
  const propertyRooms = rooms.filter((r) => r.propertyId === propertyId);
  const [scan, setScan] = useState<{ base64: string; contentType: string; preview: string } | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const set = (k: keyof typeof blank, v: string) => setF((s) => ({ ...s, [k]: v }));
  const setPerson = (i: number, k: keyof Person, v: string) => setPeople((ps) => ps.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const setExtra = (i: number, k: keyof Extra, v: string) => setExtras((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const [hydrated, setHydrated] = useState(false);
  // A checkout date in the future means the guest is still staying (in-house).
  const stillStaying = f.checkOutDate !== "" && f.checkInDate !== "" && f.checkOutDate > new Date().toLocaleDateString("en-CA");

  // Restore any in-progress draft on mount (client only — localStorage is not
  // available during SSR). Runs once; `hydrated` then gates the save effect so we
  // never overwrite the saved draft with the initial blank values before restore.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as Partial<Draft>;
        if (d.propertyId && properties.some((p) => p.id === d.propertyId)) setPropertyId(d.propertyId);
        if (typeof d.roomId === "string") setRoomId(d.roomId);
        if (d.f) setF((s) => ({ ...s, ...d.f }));
        if (Array.isArray(d.people)) setPeople(d.people);
        if (Array.isArray(d.extras)) setExtras(d.extras);
      }
    } catch {
      // Ignore corrupt/blocked storage — the form just starts empty.
    }
    setHydrated(true);
  }, [properties]);

  // Persist the draft on every change (after hydration). Best-effort.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ propertyId, roomId, f, people, extras } satisfies Draft));
    } catch {
      // Storage full/blocked (private mode) — persistence is a convenience, not critical.
    }
  }, [hydrated, propertyId, roomId, f, people, extras]);

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setScan(await fileToParts(file));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    start(async () => {
      const res = await createHistoricalStay({
        propertyId,
        checkInDate: f.checkInDate,
        checkOutDate: f.checkOutDate,
        fullName: f.fullName,
        // Country's dial code + the local number the staff typed.
        mobile: `${dialFor(f.country)} ${f.mobile.trim()}`.trim(),
        email: f.email || undefined,
        gender: f.gender || undefined,
        nationality: f.nationality || undefined,
        address: f.address || undefined,
        city: f.city || undefined,
        country: f.country || undefined,
        dob: f.dob || "",
        idType: f.idType || undefined,
        idNumber: f.idNumber || undefined,
        scanBase64: scan?.base64,
        scanContentType: scan?.contentType,
        ratePaise: f.rate ? Math.round(Number(f.rate) * 100) : 0,
        amountPaidPaise: f.paid ? Math.round(Number(f.paid) * 100) : 0,
        gstMode: f.gstMode,
        roomId: roomId || undefined,
        accompanyingGuests: people
          .filter((pp) => pp.fullName.trim())
          .map((pp) => ({
            fullName: pp.fullName,
            age: pp.age ? Number(pp.age) : null,
            gender: pp.gender || null,
            relation: pp.relation || null,
            idType: pp.idType || null,
            idNumber: pp.idNumber || null,
          })),
        extraCharges: extras
          .filter((x) => x.amount && Number(x.amount) > 0)
          .map((x) => ({
            type: x.type,
            description: x.description || null,
            amountPaise: Math.round(Number(x.amount) * 100),
          })),
      });
      if (!res.ok) { setError(res.error.message); return; }
      setSaved(f.fullName);
      setF({ ...blank, country: "India", checkInDate: f.checkInDate, gstMode: f.gstMode }); // keep last check-in + GST mode for a run of entries
      setPeople([]);
      setExtras([]);
      setScan(null);
    });
  }

  if (properties.length === 0) {
    return <p className="text-sm text-muted-foreground">No properties available. Create a property first.</p>;
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="historical-stay-form">
      {/* Stay (compulsory) */}
      <Card className="border-primary/30">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="size-4" /> Stay &amp; property (required)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="propertyId">Property <span className="text-destructive">*</span></Label>
              <select id="propertyId" value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setRoomId(""); }} required
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="hist-property">
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="roomId">Room</Label>
              <select id="roomId" value={roomId}
                onChange={(e) => {
                  const rid = e.target.value;
                  setRoomId(rid);
                  const r = rooms.find((x) => x.id === rid);
                  if (r && r.ratePaise > 0) set("rate", String(r.ratePaise / 100)); // auto-fill tariff; still editable for a discount
                }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="hist-room">
                <option value="">Any available room</option>
                {propertyRooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Fld label="Check-in date" req><Input type="date" required value={f.checkInDate} onChange={(e) => set("checkInDate", e.target.value)} data-testid="hist-checkin" /></Fld>
            <Fld label="Check-out date" req><Input type="date" required value={f.checkOutDate} onChange={(e) => set("checkOutDate", e.target.value)} data-testid="hist-checkout" /></Fld>
          </div>
          {stillStaying && (
            <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary" data-testid="hist-instay">
              Check-out is in the future — this guest is recorded as <span className="font-medium">currently staying (in-house)</span>. Nights up to today are billed; the rest post automatically as the stay continues.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Guest */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Guest details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Fld label="Full name" req><Input required value={f.fullName} onChange={(e) => set("fullName", e.target.value)} data-testid="hist-name" /></Fld>
            <Fld label="Mobile" req>
              <div className="flex">
                <span className="inline-flex h-10 min-w-14 items-center justify-center rounded-l-md border border-r-0 border-input bg-muted px-2 text-sm text-muted-foreground" title={`Country code for ${f.country || "India"}`} data-testid="hist-dial">
                  {dialFor(f.country)}
                </span>
                <Input inputMode="tel" required value={f.mobile} onChange={(e) => set("mobile", e.target.value)} placeholder="Number without country code" className="rounded-l-none" data-testid="hist-mobile" />
              </div>
            </Fld>
            <Fld label="Email"><Input type="email" inputMode="email" value={f.email} onChange={(e) => set("email", e.target.value)} data-testid="hist-email" /></Fld>
            <Fld label="Date of birth"><Input type="date" value={f.dob} onChange={(e) => set("dob", e.target.value)} /></Fld>
            <Fld label="Gender"><Input value={f.gender} onChange={(e) => set("gender", e.target.value)} /></Fld>
            <Fld label="Nationality"><Input value={f.nationality} onChange={(e) => set("nationality", e.target.value)} /></Fld>
          </div>
          <Fld label="Address"><Input value={f.address} onChange={(e) => set("address", e.target.value)} /></Fld>
          <div className="grid gap-4 sm:grid-cols-2">
            <Fld label="City"><Input value={f.city} onChange={(e) => set("city", e.target.value)} /></Fld>
            <div className="space-y-1.5">
              <Label htmlFor="country">Country</Label>
              <select id="country" value={f.country} onChange={(e) => set("country", e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="hist-country">
                {COUNTRIES.map((c) => <option key={c.iso2} value={c.name}>{c.name}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">Sets the mobile country code automatically.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ID — upload OR type */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><IdCard className="size-4" /> ID (upload or type — optional)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="idType">ID type</Label>
              <select id="idType" value={f.idType} onChange={(e) => set("idType", e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {ID_TYPES.map((t) => <option key={t || "none"} value={t}>{t ? t.replace(/_/g, " ") : "Select…"}</option>)}
              </select>
            </div>
            <Fld label="ID number"><Input value={f.idNumber} onChange={(e) => set("idNumber", e.target.value)} placeholder="Or upload the document below" /></Fld>
          </div>
          <div className="space-y-1.5">
            <Label>Upload ID document / photo</Label>
            <input type="file" accept="image/*,application/pdf" capture="environment" onChange={onPhoto} className="block w-full text-sm" data-testid="hist-photo" />
            {scan?.preview?.startsWith("data:image") && (
              // eslint-disable-next-line @next/next/no-img-element -- local data-URL preview
              <img src={scan.preview} alt="ID preview" className="mt-2 max-h-40 rounded-md border" />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Accompanying guests — same room + same bill */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Users className="size-4" /> Accompanying guests</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">If more than one guest shared this room, add each person here — they share the same stay, room and bill. Each person can have their own ID.</p>
          {people.map((pp, i) => (
            <div key={i} className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Guest {i + 2}</span>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-muted-foreground hover:text-destructive" onClick={() => setPeople((ps) => ps.filter((_, j) => j !== i))}>Remove</Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input placeholder="Full name *" value={pp.fullName} onChange={(e) => setPerson(i, "fullName", e.target.value)} data-testid={`person-name-${i}`} />
                <Input placeholder="Relation (e.g. Spouse, Colleague)" value={pp.relation} onChange={(e) => setPerson(i, "relation", e.target.value)} />
                <Input type="number" inputMode="numeric" placeholder="Age" value={pp.age} onChange={(e) => setPerson(i, "age", e.target.value)} />
                <Input placeholder="Gender" value={pp.gender} onChange={(e) => setPerson(i, "gender", e.target.value)} />
                <select value={pp.idType} onChange={(e) => setPerson(i, "idType", e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {ID_OPTS.map((t) => <option key={t || "none"} value={t}>{t ? t.replace(/_/g, " ") : "ID type…"}</option>)}
                </select>
                <Input placeholder="ID number" value={pp.idNumber} onChange={(e) => setPerson(i, "idNumber", e.target.value)} />
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setPeople((ps) => [...ps, { ...blankPerson }])} data-testid="add-person">+ Add person</Button>
        </CardContent>
      </Card>

      {/* Extra charges — meals, laundry, cab… on the same bill */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Receipt className="size-4" /> Extra charges</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Did the guest also have meals, laundry, a cab, etc.? Add each one — it goes on the same bill with the correct GST.</p>
          {extras.map((x, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,10rem)_1fr_minmax(0,8rem)_auto] sm:items-center">
              <select value={x.type} onChange={(e) => setExtra(i, "type", e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid={`extra-type-${i}`}>
                {CHARGE_TYPES.map((t) => <option key={t} value={t}>{CHARGE_LABEL[t]}</option>)}
              </select>
              <Input placeholder="Note (optional, e.g. Dinner)" value={x.description} onChange={(e) => setExtra(i, "description", e.target.value)} />
              <Input type="number" inputMode="numeric" min={0} placeholder="Amount ₹" value={x.amount} onChange={(e) => setExtra(i, "amount", e.target.value)} data-testid={`extra-amount-${i}`} />
              <Button type="button" variant="ghost" size="sm" className="h-9 text-muted-foreground hover:text-destructive" onClick={() => setExtras((xs) => xs.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setExtras((xs) => [...xs, { ...blankExtra }])} data-testid="add-extra">+ Add charge</Button>
        </CardContent>
      </Card>

      {/* Money (optional) */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Bill (optional)</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>GST on the prices you enter</Label>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="gstMode" value="inclusive" checked={f.gstMode === "inclusive"} onChange={() => set("gstMode", "inclusive")} data-testid="gst-inclusive" />
                Price includes GST (all-in)
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="gstMode" value="exclusive" checked={f.gstMode === "exclusive"} onChange={() => set("gstMode", "exclusive")} data-testid="gst-exclusive" />
                Add GST on top
              </label>
            </div>
            <p className="text-xs text-muted-foreground">Applies to the room rate <span className="font-medium">and</span> every extra charge above.</p>
          </div>
          <Fld label="Room rate per night (₹)"><Input type="number" inputMode="numeric" min={0} value={f.rate} onChange={(e) => set("rate", e.target.value)} placeholder="Auto-fills from the room" /></Fld>
          <Fld label="Amount collected (₹)"><Input type="number" inputMode="numeric" min={0} value={f.paid} onChange={(e) => set("paid", e.target.value)} placeholder="Room + extras total, or what they paid" /></Fld>
          <p className="text-xs text-muted-foreground sm:col-span-2">Pick a room and the nightly rate fills in automatically — <span className="font-medium">edit it</span> if the guest got a discount or special price. A folio + GST bill is created from the room rate + extras. Leave everything blank for history only.</p>
        </CardContent>
      </Card>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {saved && <p className="rounded-md border border-emerald-600/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400" data-testid="hist-saved">✔ Saved {saved}&apos;s stay. Enter the next one.</p>}

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" size="lg" disabled={pending || !propertyId || !f.fullName.trim() || !f.checkInDate || !f.checkOutDate} className="sm:min-w-44" data-testid="hist-submit">
          {pending ? "Saving…" : "Save historical stay"}
        </Button>
      </div>
    </form>
  );
}

function Fld({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}{req ? <span className="text-destructive"> *</span> : null}</Label>
      {children}
    </div>
  );
}
