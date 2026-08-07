"use client";

/**
 * Check-in wizard · Form C step (03 T7). Shown only for FOREIGN guests (a passport
 * or visa was captured in Identity). Reception can auto-fill passport fields via
 * Document AI (mock → empty, so manual entry is the fallback), verifies, and saves
 * — `saveCForm` generates the FRRO Form C PDF. Passport/visa numbers are not typed
 * here; they come from the encrypted IDs already on file.
 */
import { useState, useTransition, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  nationality: "",
  passportPlaceOfIssue: "",
  passportIssueDate: "",
  passportExpiryDate: "",
  visaType: "",
  visaIssueDate: "",
  visaExpiryDate: "",
  arrivalFromCity: "",
  arrivalFromCountry: "",
  arrivalInIndiaDate: "",
  nextDestination: "",
  purposeOfVisit: "",
};

export function CFormStep({
  context,
  saved,
  onSaved,
}: {
  context: CheckInContext;
  saved: boolean;
  onSaved: () => void;
}) {
  const [f, setF] = useState<Fields>({ ...EMPTY, nationality: context.guestNationality ?? "" });
  const [pending, start] = useTransition();
  const [extracting, startExtract] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof Fields) => (e: ChangeEvent<HTMLInputElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const autofill = () => {
    setError(null);
    startExtract(async () => {
      const res = await extractPassportForCheckIn({ reservationId: context.id });
      if (!res.ok) {
        setError(res.error?.message ?? "Could not read the passport.");
        return;
      }
      const d = res.data;
      const got = Object.values(d).filter(Boolean).length;
      setF((prev) => ({
        ...prev,
        nationality: d.nationality || prev.nationality,
        passportPlaceOfIssue: d.passportPlaceOfIssue || prev.passportPlaceOfIssue,
        passportIssueDate: d.passportIssueDate || prev.passportIssueDate,
        passportExpiryDate: d.passportExpiryDate || prev.passportExpiryDate,
      }));
      toast[got > 0 ? "success" : "message"](
        got > 0 ? `Auto-filled ${got} field(s) — please verify` : "No fields read from the scan — enter them manually",
      );
    });
  };

  const save = () => {
    if (!f.nationality.trim()) {
      setError("Nationality is required for Form C.");
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Form C — foreign guest</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            FRRO arrival report. Passport &amp; visa numbers come from the captured IDs.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={autofill} disabled={extracting} data-testid="cform-autofill">
          <Sparkles /> {extracting ? "Reading…" : "Auto-fill"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="nationality" label="Nationality *" value={f.nationality} onChange={set("nationality")} testid="cform-nationality" />
        <Field id="pp-place" label="Passport place of issue" value={f.passportPlaceOfIssue} onChange={set("passportPlaceOfIssue")} />
        <Field id="pp-issue" label="Passport issue date" type="date" value={f.passportIssueDate} onChange={set("passportIssueDate")} />
        <Field id="pp-exp" label="Passport expiry" type="date" value={f.passportExpiryDate} onChange={set("passportExpiryDate")} />
        <Field id="visa-type" label="Visa type" value={f.visaType} onChange={set("visaType")} />
        <Field id="visa-exp" label="Visa expiry" type="date" value={f.visaExpiryDate} onChange={set("visaExpiryDate")} />
        <Field id="arr-city" label="Arriving from (city)" value={f.arrivalFromCity} onChange={set("arrivalFromCity")} />
        <Field id="arr-country" label="Arriving from (country)" value={f.arrivalFromCountry} onChange={set("arrivalFromCountry")} />
        <Field id="arr-india" label="Date of arrival in India" type="date" value={f.arrivalInIndiaDate} onChange={set("arrivalInIndiaDate")} />
        <Field id="next-dest" label="Next destination" value={f.nextDestination} onChange={set("nextDestination")} />
        <Field id="purpose" label="Purpose of visit" value={f.purposeOfVisit} onChange={set("purposeOfVisit")} />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive" data-testid="cform-error">
          {error}
        </p>
      ) : null}

      <Button type="button" onClick={save} disabled={pending} className="w-full sm:w-auto" data-testid="save-cform">
        {saved ? <Check /> : null}
        {pending ? "Generating…" : saved ? "Saved — re-generate" : "Generate Form C"}
      </Button>
      {saved ? (
        <p className="text-sm text-success" data-testid="cform-saved">
          Form C generated. Continue to finish check-in.
        </p>
      ) : null}
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  testid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  testid?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={onChange} data-testid={testid} autoComplete="off" />
    </div>
  );
}
