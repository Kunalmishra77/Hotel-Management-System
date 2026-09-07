"use client";

/**
 * Historical data-entry form (26 objective). The client photographs an existing
 * paper record; the photo is captured as the source, and the guest details are
 * entered — either typed from the photo, or pre-filled by AI-assist from pasted
 * record text (empty in the sandbox → manual). Creating the guest goes through
 * the audited createGuest; an attached ID photo is stored encrypted/masked.
 */
import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { Camera, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dataEntryCreateGuestAction, extractGuestFieldsAction } from "../data-entry-actions";
import type { GuestFormState } from "../form-actions";

const INITIAL: GuestFormState = { status: "idle" };
const ID_TYPES = ["", "AADHAAR", "PASSPORT", "DRIVING_LICENCE", "VOTER_ID", "PAN", "VISA"] as const;
type Fields = Record<string, string>;
const EMPTY: Fields = {};

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

export function DataEntryForm() {
  const [state, submit, pending] = useActionState(dataEntryCreateGuestAction, INITIAL);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [recordText, setRecordText] = useState("");
  const [scan, setScan] = useState<{ base64: string; contentType: string; preview: string } | null>(null);
  const [idType, setIdType] = useState("");
  const [aiPending, startAi] = useTransition();
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const set = (k: string, v: string) => setFields((f) => ({ ...f, [k]: v }));
  const fieldError = (n: string) => (state.status === "error" ? state.fieldErrors?.[n]?.[0] : undefined);

  function autofill() {
    setAiMsg(null);
    startAi(async () => {
      const res = await extractGuestFieldsAction(recordText);
      if (!res.ok) { setAiMsg(res.error.message); return; }
      const got = res.data as Fields;
      const keys = Object.keys(got).filter((k) => got[k]);
      if (keys.length === 0) { setAiMsg("No fields could be read automatically — enter the details manually below."); return; }
      setFields((f) => ({ ...f, ...Object.fromEntries(keys.map((k) => [k, got[k] as string])) }));
      setAiMsg(`Auto-filled ${keys.length} field(s) — please review before saving.`);
    });
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setScan(await fileToParts(file));
  }

  return (
    <form action={submit} className="space-y-4" data-testid="data-entry-form">
      {/* Source document */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Camera className="size-4" /> Source record</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Photograph or upload the existing record. It&apos;s stored as the source; if it&apos;s an ID, pick the type to file it under the guest.</p>
          <input type="file" accept="image/*,application/pdf" capture="environment" onChange={onPhoto} className="block w-full text-sm" data-testid="data-entry-photo" />
          {scan?.preview?.startsWith("data:image") && (
            // eslint-disable-next-line @next/next/no-img-element -- local data-URL preview, not a remote asset
            <img src={scan.preview} alt="Record preview" className="max-h-56 rounded-md border" />
          )}
          <div className="space-y-1.5">
            <Label htmlFor="idType">ID type (optional)</Label>
            <select id="idType" value={idType} onChange={(e) => setIdType(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              {ID_TYPES.map((t) => <option key={t || "none"} value={t}>{t ? t.replace(/_/g, " ") : "Not an ID / skip"}</option>)}
            </select>
          </div>
          {scan && <input type="hidden" name="scanBase64" value={scan.base64} />}
          {scan && <input type="hidden" name="scanContentType" value={scan.contentType} />}
          <input type="hidden" name="idType" value={idType} />
        </CardContent>
      </Card>

      {/* AI-assist */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="size-4" /> AI-assist (optional)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Paste any text from the record (or type what you can read) and auto-fill the form. Always review before saving. Auto-fill activates when an AI provider is configured.</p>
          <textarea value={recordText} onChange={(e) => setRecordText(e.target.value)} rows={3}
            placeholder="e.g. Ramesh Kumar, 9812345678, Delhi, checked in 12 Jan…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" data-testid="data-entry-text" />
          <Button type="button" variant="outline" size="sm" disabled={aiPending || !recordText.trim()} onClick={autofill} data-testid="data-entry-autofill">
            {aiPending ? "Reading…" : "Auto-fill from text"}
          </Button>
          {aiMsg && <p className="text-xs text-muted-foreground">{aiMsg}</p>}
        </CardContent>
      </Card>

      {/* Guest details */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Guest details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <F name="fullName" label="Full name" required value={fields.fullName ?? ""} set={set} error={fieldError("fullName")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <F name="mobile" label="Mobile" required inputMode="tel" value={fields.mobile ?? ""} set={set} error={fieldError("mobile")} />
            <F name="email" label="Email" type="email" value={fields.email ?? ""} set={set} error={fieldError("email")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <F name="dob" label="Date of birth" type="date" value={fields.dob ?? ""} set={set} error={fieldError("dob")} />
            <F name="gender" label="Gender" value={fields.gender ?? ""} set={set} />
            <F name="nationality" label="Nationality" value={fields.nationality ?? ""} set={set} />
          </div>
          <F name="addressLine" label="Address" value={fields.addressLine ?? ""} set={set} />
          <div className="grid gap-4 sm:grid-cols-2">
            <F name="city" label="City" value={fields.city ?? ""} set={set} />
            <F name="state" label="State" value={fields.state ?? ""} set={set} />
            <F name="country" label="Country" value={fields.country ?? ""} set={set} />
            <F name="pincode" label="PIN code" inputMode="numeric" value={fields.pincode ?? ""} set={set} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <F name="companyName" label="Company" value={fields.companyName ?? ""} set={set} />
            <F name="gstNumber" label="GSTIN" value={fields.gstNumber ?? ""} set={set} error={fieldError("gstNumber")} />
          </div>
          <F name="occupation" label="Occupation" value={fields.occupation ?? ""} set={set} />
          <F name="purposeOfVisit" label="Purpose of visit" value={fields.purposeOfVisit ?? ""} set={set} />
        </CardContent>
      </Card>

      {state.status === "error" && <p role="alert" className="text-sm text-destructive">{state.message}</p>}

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" size="lg" disabled={pending || !(fields.fullName ?? "").trim()} className="sm:min-w-40" data-testid="data-entry-submit">
          {pending ? "Saving…" : "Save guest record"}
        </Button>
        <Button asChild variant="outline" size="lg"><Link href="/guests">Cancel</Link></Button>
      </div>
    </form>
  );
}

function F({
  name, label, value, set, error, required, ...rest
}: {
  name: string; label: string; value: string; set: (k: string, v: string) => void; error?: string; required?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "value">) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-0.5">
        <Label htmlFor={name}>{label}</Label>
        {required && <span aria-hidden="true" className="text-destructive">*</span>}
      </div>
      <Input id={name} name={name} value={value} onChange={(e) => set(name, e.target.value)}
        required={required} aria-invalid={Boolean(error)} {...rest} />
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
