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
import { useState, useTransition } from "react";
import { CalendarClock, IdCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createHistoricalStay } from "../historical-actions";

type Property = { id: string; name: string };
type Room = { id: string; propertyId: string; label: string };
const ID_TYPES = ["", "AADHAAR", "PASSPORT", "DRIVING_LICENCE", "VOTER_ID", "PAN", "VISA"] as const;

const blank = {
  fullName: "", mobile: "", address: "", city: "", country: "India", dob: "",
  checkInDate: "", checkOutDate: "", idType: "", idNumber: "", rate: "", paid: "",
};

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
  const propertyRooms = rooms.filter((r) => r.propertyId === propertyId);
  const [scan, setScan] = useState<{ base64: string; contentType: string; preview: string } | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const set = (k: keyof typeof blank, v: string) => setF((s) => ({ ...s, [k]: v }));

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
        mobile: f.mobile,
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
        roomId: roomId || undefined,
      });
      if (!res.ok) { setError(res.error.message); return; }
      setSaved(f.fullName);
      setF({ ...blank, country: "India", checkInDate: f.checkInDate }); // keep last check-in for a run of same-day entries
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
              <select id="roomId" value={roomId} onChange={(e) => setRoomId(e.target.value)}
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
        </CardContent>
      </Card>

      {/* Guest */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Guest details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Fld label="Full name" req><Input required value={f.fullName} onChange={(e) => set("fullName", e.target.value)} data-testid="hist-name" /></Fld>
            <Fld label="Mobile" req><Input inputMode="tel" required value={f.mobile} onChange={(e) => set("mobile", e.target.value)} data-testid="hist-mobile" /></Fld>
          </div>
          <Fld label="Address"><Input value={f.address} onChange={(e) => set("address", e.target.value)} /></Fld>
          <div className="grid gap-4 sm:grid-cols-3">
            <Fld label="City"><Input value={f.city} onChange={(e) => set("city", e.target.value)} /></Fld>
            <Fld label="Country"><Input value={f.country} onChange={(e) => set("country", e.target.value)} /></Fld>
            <Fld label="Date of birth"><Input type="date" value={f.dob} onChange={(e) => set("dob", e.target.value)} /></Fld>
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

      {/* Money (optional) */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Bill (optional)</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Fld label="Room rate per night (₹)"><Input type="number" inputMode="numeric" min={0} value={f.rate} onChange={(e) => set("rate", e.target.value)} placeholder="e.g. 3000" /></Fld>
          <Fld label="Amount collected (₹)"><Input type="number" inputMode="numeric" min={0} value={f.paid} onChange={(e) => set("paid", e.target.value)} placeholder="e.g. 6000" /></Fld>
          <p className="text-xs text-muted-foreground sm:col-span-2">Leave blank if you only need the stay history. If a rate is given, a folio + GST bill is created for the stay.</p>
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
