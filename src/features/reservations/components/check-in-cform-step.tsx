"use client";

/**
 * Check-in wizard · Form C step (03 T7). Shown only for FOREIGN guests (a passport
 * or visa was captured in Identity). The step opens pre-filled from data already
 * on file — this booking's saved Form C, or the guest's Form C from an earlier
 * stay (same passport/visa) — with NO outside AI (client, 15 Nov 2026: the old
 * AI auto-fill failed and showed an error). Country and purpose are picked from
 * lists so the FRRO report never carries typos like "norway". Passport/visa
 * numbers are not typed here; they come from the encrypted IDs already on file.
 */
import { useEffect, useMemo, useState, useTransition, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COUNTRIES } from "@/lib/constants/countries";
import { saveCForm, extractPassportForCheckIn } from "../checkin-actions";
import type { CheckInContext } from "../queries";

type Fields = {
  nationality: string;
  passportPlaceOfIssue: string;
  passportIssueDate: string;
  passportExpiryDate: string;
  visaType: string;
  visaIssueDate: string;
  visaExpiryDate: string;
  arrivalFromCity: string;
  arrivalFromCountry: string;
  arrivalInIndiaDate: string;
  nextDestination: string;
  purposeOfVisit: string;
};

const EMPTY: Fields = {
  nationality: "", passportPlaceOfIssue: "", passportIssueDate: "", passportExpiryDate: "",
  visaType: "", visaIssueDate: "", visaExpiryDate: "", arrivalFromCity: "", arrivalFromCountry: "",
  arrivalInIndiaDate: "", nextDestination: "", purposeOfVisit: "",
};

/** The visa categories e-FRRO lists most often for hotel guests. */
const VISA_TYPES = ["e-Tourist Visa", "Tourist Visa", "e-Business Visa", "Business Visa", "e-Medical Visa", "Medical Visa", "e-Conference Visa", "Employment Visa", "Student Visa", "Journalist Visa", "Transit Visa", "OCI Card holder", "Diplomatic / Official", "Not required (Nepal / Bhutan)"];
const PURPOSES = ["Tourism", "Business", "Medical treatment", "Conference / Event", "Employment", "Study", "Visiting family / friends", "Transit", "Other"];
/** Nationals who need no visa for India — the visa fields don't apply. */
const VISA_EXEMPT = new Set(["Nepal", "Bhutan"]);

/** "norway" / "NORWAY" → "Norway" (the list's own spelling), else as typed. */
function canonicalCountry(v: string | null | undefined): string {
  const t = (v ?? "").trim();
  if (!t) return "";
  return COUNTRIES.find((c) => c.name.toLowerCase() === t.toLowerCase() || c.iso2.toLowerCase() === t.toLowerCase())?.name ?? t;
}

const todayIst = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const fmt = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Everything FRRO would reject, in plain words. Empty = ready. */
function problems(f: Fields): string[] {
  const out: string[] = [];
  const today = todayIst();
  if (!f.nationality) out.push("Pick the nationality.");
  if (!f.passportIssueDate) out.push("Enter the passport issue date.");
  if (!f.passportExpiryDate) out.push("Enter the passport expiry date.");
  if (f.passportIssueDate && f.passportIssueDate > today) out.push("Passport issue date can't be in the future.");
  if (f.passportIssueDate && f.passportExpiryDate && f.passportExpiryDate <= f.passportIssueDate) out.push("Passport expiry must be after its issue date.");
  if (f.passportExpiryDate && f.passportExpiryDate < today) out.push(`The passport expired on ${fmt(f.passportExpiryDate)} — check the date.`);
  const visaNeeded = !VISA_EXEMPT.has(f.nationality) && f.visaType !== "Not required (Nepal / Bhutan)" && f.visaType !== "OCI Card holder";
  if (visaNeeded && !f.visaType) out.push("Pick the visa type.");
  if (visaNeeded && !f.visaExpiryDate) out.push("Enter the visa expiry date.");
  if (f.visaIssueDate && f.visaExpiryDate && f.visaExpiryDate <= f.visaIssueDate) out.push("Visa expiry must be after its issue date.");
  if (!f.arrivalInIndiaDate) out.push("Enter the date the guest arrived in India.");
  if (f.arrivalInIndiaDate && f.arrivalInIndiaDate > today) out.push("Arrival in India can't be in the future.");
  if (!f.purposeOfVisit) out.push("Pick the purpose of visit.");
  return out;
}

export function CFormStep({
  context,
  saved,
  onSaved,
}: {
  context: CheckInContext;
  saved: boolean;
  onSaved: () => void;
}) {
  const [f, setF] = useState<Fields>({ ...EMPTY, nationality: canonicalCountry(context.guestNationality) });
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  // Pre-fill once from what's on file (this booking's Form C, else the guest's last one).
  useEffect(() => {
    startLoad(async () => {
      const res = await extractPassportForCheckIn({ reservationId: context.id });
      if (!res.ok) return; // nothing on file is fine — staff type it in
      const d = res.data;
      setF((prev) => ({
        nationality: canonicalCountry(d.nationality) || prev.nationality,
        passportPlaceOfIssue: d.passportPlaceOfIssue ?? prev.passportPlaceOfIssue,
        passportIssueDate: d.passportIssueDate ?? prev.passportIssueDate,
        passportExpiryDate: d.passportExpiryDate ?? prev.passportExpiryDate,
        visaType: d.visaType ?? prev.visaType,
        visaIssueDate: d.visaIssueDate ?? prev.visaIssueDate,
        visaExpiryDate: d.visaExpiryDate ?? prev.visaExpiryDate,
        arrivalFromCity: d.arrivalFromCity ?? prev.arrivalFromCity,
        arrivalFromCountry: canonicalCountry(d.arrivalFromCountry) || prev.arrivalFromCountry,
        arrivalInIndiaDate: d.arrivalInIndiaDate ?? prev.arrivalInIndiaDate,
        nextDestination: d.nextDestination ?? prev.nextDestination,
        purposeOfVisit: d.purposeOfVisit ?? prev.purposeOfVisit,
      }));
      if (d.source === "this-booking") setLoadedFrom("Loaded the Form C saved for this booking.");
      else if (d.source === "earlier-stay" && d.sourceDate) setLoadedFrom(`Passport & visa filled from the guest's stay of ${fmt(d.sourceDate)} — check they're still the same.`);
    });
  }, [context.id]);

  const set = (k: keyof Fields) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));
  const issues = useMemo(() => problems(f), [f]);
  const visaApplies = !VISA_EXEMPT.has(f.nationality);

  const save = () => {
    setTried(true);
    if (issues.length) {
      setError("Fix the highlighted points below, then generate.");
      return;
    }
    setError(null);
    const orUndef = (s: string) => (s.trim() ? s.trim() : undefined);
    start(async () => {
      const res = await saveCForm({
        reservationId: context.id,
        nationality: f.nationality.trim(),
        passportPlaceOfIssue: orUndef(f.passportPlaceOfIssue),
        passportIssueDate: orUndef(f.passportIssueDate),
        passportExpiryDate: orUndef(f.passportExpiryDate),
        visaType: orUndef(f.visaType),
        visaIssueDate: orUndef(f.visaIssueDate),
        visaExpiryDate: orUndef(f.visaExpiryDate),
        arrivalFromCity: orUndef(f.arrivalFromCity),
        arrivalFromCountry: orUndef(f.arrivalFromCountry),
        arrivalInIndiaDate: orUndef(f.arrivalInIndiaDate),
        nextDestination: orUndef(f.nextDestination),
        purposeOfVisit: orUndef(f.purposeOfVisit),
      });
      if (!res.ok) {
        setError(res.error?.message ?? "Could not save the Form C.");
        return;
      }
      onSaved();
      toast.success("Form C generated");
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">Form C — foreign guest</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          FRRO arrival report for {context.guestName}. Passport &amp; visa numbers come from the IDs captured in Identity. Fields marked * are needed by FRRO.
        </p>
        {loading ? <p className="mt-1 text-xs text-muted-foreground">Checking earlier Form C on file…</p> : null}
        {loadedFrom ? <p className="mt-1 text-xs text-primary" data-testid="cform-prefilled">{loadedFrom}</p> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField id="nationality" label="Nationality *" value={f.nationality} onChange={set("nationality")} options={COUNTRIES.map((c) => c.name)} testid="cform-nationality" />
        <Field id="pp-place" label="Passport place of issue" value={f.passportPlaceOfIssue} onChange={set("passportPlaceOfIssue")} placeholder="e.g. Oslo" />
        <Field id="pp-issue" label="Passport issue date *" type="date" value={f.passportIssueDate} onChange={set("passportIssueDate")} max={todayIst()} />
        <Field id="pp-exp" label="Passport expiry *" type="date" value={f.passportExpiryDate} onChange={set("passportExpiryDate")} />
        {visaApplies ? (
          <>
            <SelectField id="visa-type" label="Visa type *" value={f.visaType} onChange={set("visaType")} options={VISA_TYPES} />
            <Field id="visa-issue" label="Visa issue date" type="date" value={f.visaIssueDate} onChange={set("visaIssueDate")} max={todayIst()} />
            <Field id="visa-exp" label="Visa expiry *" type="date" value={f.visaExpiryDate} onChange={set("visaExpiryDate")} />
          </>
        ) : (
          <p className="self-end text-xs text-muted-foreground sm:col-span-2">No visa needed for {f.nationality} nationals.</p>
        )}
        <Field id="arr-india" label="Date of arrival in India *" type="date" value={f.arrivalInIndiaDate} onChange={set("arrivalInIndiaDate")} max={todayIst()} />
        <Field id="arr-city" label="Arriving from (city)" value={f.arrivalFromCity} onChange={set("arrivalFromCity")} placeholder="e.g. Mumbai or Oslo" />
        <SelectField id="arr-country" label="Arriving from (country)" value={f.arrivalFromCountry} onChange={set("arrivalFromCountry")} options={COUNTRIES.map((c) => c.name)} />
        <Field id="next-dest" label="Next destination" value={f.nextDestination} onChange={set("nextDestination")} placeholder="e.g. Jaipur" />
        <SelectField id="purpose" label="Purpose of visit *" value={f.purposeOfVisit} onChange={set("purposeOfVisit")} options={PURPOSES} />
      </div>

      {tried && issues.length > 0 ? (
        <ul className="list-disc space-y-0.5 rounded-md border border-destructive/30 bg-destructive/5 py-2 pl-7 pr-3 text-sm text-destructive" data-testid="cform-issues">
          {issues.map((m) => <li key={m}>{m}</li>)}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive" data-testid="cform-error">{error}</p>
      ) : null}

      <Button type="button" onClick={save} disabled={pending} className="w-full sm:w-auto" data-testid="save-cform">
        {saved ? <Check /> : null}
        {pending ? "Generating…" : saved ? "Saved — re-generate" : "Generate Form C"}
      </Button>
      {saved ? (
        <p className="text-sm text-success" data-testid="cform-saved">Form C generated. Continue to finish check-in.</p>
      ) : null}
    </div>
  );
}

function Field({
  id, label, value, onChange, type = "text", testid, placeholder, max,
}: {
  id: string; label: string; value: string; onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  type?: string; testid?: string; placeholder?: string; max?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={onChange} data-testid={testid} autoComplete="off" placeholder={placeholder} max={max} />
    </div>
  );
}

function SelectField({
  id, label, value, onChange, options, testid,
}: {
  id: string; label: string; value: string; onChange: (e: ChangeEvent<HTMLSelectElement>) => void; options: string[]; testid?: string;
}) {
  // A value not in the list (old free-text data) stays selectable rather than vanishing.
  const all = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} value={value} onChange={onChange} data-testid={testid}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <option value="">Select…</option>
        {all.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
