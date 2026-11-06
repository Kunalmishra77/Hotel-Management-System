"use client";

/**
 * Check-in wizard · Guest details step (client, 5 Nov 2026). The booking took only
 * name + mobile + address; check-in collects the rest. Mandatory: WhatsApp
 * (usually one tick — same as mobile), gender, nationality, home address with
 * city and country. Email and date of birth are optional — left blank, they show
 * on the booking's "Pending information" card to collect later. Whatever is
 * already on file is pre-filled; contact numbers stay masked.
 *
 * A RETURNING guest (stayed before) is never made to re-fill this: the step is
 * optional for them and whatever their old record lacks shows on the booking's
 * pending card (client, 6 Nov 2026).
 */
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COUNTRIES } from "@/lib/constants/countries";
import { saveCheckInDetails } from "@/features/guests/checkin-details-action";
import type { CheckInGuestDetails } from "../queries";

const GENDERS = ["Male", "Female", "Other"];
const selectCls = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm";

/** The list plus the stored value when it isn't one of them (e.g. "Indian"). */
const withCurrent = (list: string[], current: string | null) => (current && !list.includes(current) ? [current, ...list] : list);

export function DetailsStep({
  guestId,
  details,
  returning,
  saved,
  onSaved,
}: {
  guestId: string;
  details: CheckInGuestDetails;
  returning: boolean;
  saved: boolean;
  onSaved: () => void;
}) {
  const countryNames = COUNTRIES.map((c) => c.name);
  const [mobile, setMobile] = useState("");
  const [sameAsMobile, setSameAsMobile] = useState(!details.maskedWhatsapp);
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [dob, setDob] = useState(details.dob ?? "");
  const [gender, setGender] = useState(details.gender ?? "");
  const [nationality, setNationality] = useState(details.nationality ?? "India");
  const [addr, setAddr] = useState({
    addressLine: details.addressLine ?? "",
    city: details.city ?? "",
    state: details.state ?? "",
    pincode: details.pincode ?? "",
    country: details.country ?? "India",
  });
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const save = () => {
    setError(null);
    const need = [
      !gender && "gender",
      !nationality && "nationality",
      !addr.addressLine.trim() && "home address",
      !addr.city.trim() && "city",
      !addr.country && "country",
    ].filter(Boolean);
    if (need.length) { setError(`Fill in: ${need.join(", ")}.`); return; }
    if (!sameAsMobile && !whatsapp.trim() && !details.maskedWhatsapp) { setError("Enter the WhatsApp number, or tick “Same as mobile”."); return; }
    start(async () => {
      const res = await saveCheckInDetails({
        guestId,
        mobile: mobile.trim() || null,
        whatsappSameAsMobile: sameAsMobile,
        whatsapp: sameAsMobile ? null : whatsapp.trim() || null,
        email: email.trim() || null,
        dob: dob || null,
        gender,
        nationality,
        ...addr,
      });
      if (!res.ok) { setError(res.error.message); return; }
      onSaved();
      toast.success("Guest details saved");
    });
  };

  const missingOptional = [!details.maskedEmail && !email.trim() ? "email" : null, !dob ? "date of birth" : null].filter(Boolean);

  return (
    <div className="space-y-5" data-testid="checkin-details">
      <div>
        <h3 className="text-sm font-semibold">Guest details</h3>
        {returning ? (
          <p className="mt-2 rounded-md border border-success/40 bg-success/10 p-3 text-sm" data-testid="returning-guest">
            <span className="font-medium">Returning guest — details from the earlier stay are on file.</span> Nothing to fill here: press Continue. Change something only if it is different now; anything still missing shows on the booking&apos;s Pending information card.
          </p>
        ) : (
          <p className="mt-0.5 text-sm text-muted-foreground">
            Fields marked <span className="text-destructive">*</span> are needed to check in. Email and date of birth can wait — if skipped they stay as pending on the booking.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <F label="Mobile" hint={details.maskedMobile ? `On file: ${details.maskedMobile} — type only to change it` : undefined} required>
          <Input type="tel" inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder={details.maskedMobile ?? "Mobile with country code"} className="h-11" data-testid="ci-mobile" />
        </F>
        <F label="WhatsApp" required hint={!sameAsMobile && details.maskedWhatsapp ? `On file: ${details.maskedWhatsapp} — type only to change it` : undefined}>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={sameAsMobile} onChange={(e) => setSameAsMobile(e.target.checked)} className="size-4" data-testid="ci-wa-same" />
            Same as mobile
          </label>
          {!sameAsMobile && (
            <Input type="tel" inputMode="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder={details.maskedWhatsapp ?? "WhatsApp number"} className="h-11" data-testid="ci-whatsapp" />
          )}
        </F>
        <F label="Email" hint={details.maskedEmail ? `On file: ${details.maskedEmail} — type only to change it` : "Optional — pending if left blank"}>
          <Input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className="h-11" data-testid="ci-email" />
        </F>
        <F label="Date of birth" hint="Optional — pending if left blank">
          <Input type="date" max={today} value={dob} onChange={(e) => setDob(e.target.value)} className="h-11" data-testid="ci-dob" />
        </F>
        <F label="Gender" required>
          <select value={gender} onChange={(e) => setGender(e.target.value)} className={selectCls} data-testid="ci-gender">
            <option value="">Select…</option>
            {withCurrent(GENDERS, details.gender).map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </F>
        <F label="Nationality" required>
          <select value={nationality} onChange={(e) => setNationality(e.target.value)} className={selectCls} data-testid="ci-nationality">
            {withCurrent(countryNames, details.nationality).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </F>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">Home address <span className="text-destructive">*</span></p>
        <Input value={addr.addressLine} onChange={(e) => setAddr({ ...addr, addressLine: e.target.value })} placeholder="House / street / area" aria-label="Home address" className="h-11" data-testid="ci-address" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} placeholder="City *" aria-label="City" className="h-11" data-testid="ci-city" />
          <Input value={addr.state} onChange={(e) => setAddr({ ...addr, state: e.target.value })} placeholder="State" aria-label="State" className="h-11" />
          <Input inputMode="numeric" value={addr.pincode} onChange={(e) => setAddr({ ...addr, pincode: e.target.value })} placeholder="PIN / ZIP" aria-label="PIN code" className="h-11" />
          <select value={addr.country} onChange={(e) => setAddr({ ...addr, country: e.target.value })} className={selectCls} aria-label="Country" data-testid="ci-country">
            {withCurrent(countryNames, details.country).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {error ? <p role="alert" className="text-sm text-destructive" data-testid="details-error">{error}</p> : null}

      <Button type="button" onClick={save} disabled={pending} className="w-full sm:w-auto" data-testid="save-details">
        {saved ? <Check /> : null}
        {pending ? "Saving…" : saved ? "Saved — re-save" : "Save guest details"}
      </Button>
      {saved ? (
        <p className="text-sm text-success" data-testid="details-saved">
          Saved.{missingOptional.length ? ` ${missingOptional.join(" and ")} will show as pending on the booking.` : ""} Continue.
        </p>
      ) : null}
    </div>
  );
}

function F({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}{required ? <span className="text-destructive"> *</span> : null}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
