"use client";

/**
 * Edit-guest form (FR-2). Every detail captured at booking/check-in is editable
 * here — including AFTER check-in, because a guest is a permanent record and this
 * form is not gated by reservation status. Non-contact fields pre-fill from the
 * stored record; contact fields (mobile/whatsapp/email) show the current value
 * MASKED and stay blank — leave them blank to keep, or type a new value to
 * correct. Validation + persistence are server-side (updateGuest).
 */
import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateGuestFormAction, type GuestFormState } from "../form-actions";
import type { GuestEditData } from "../queries";

const INITIAL: GuestFormState = { status: "idle" };

export function EditGuestForm({ guest }: { guest: GuestEditData }) {
  const [state, submit, pending] = useActionState(updateGuestFormAction, INITIAL);
  const fieldError = (name: string) => (state.status === "error" ? state.fieldErrors?.[name]?.[0] : undefined);

  return (
    <form action={submit} className="space-y-4" data-testid="edit-guest-form">
      <input type="hidden" name="id" value={guest.id} />

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Identity</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Field name="fullName" label="Full name" required defaultValue={guest.fullName} error={fieldError("fullName")} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field name="dob" label="Date of birth" type="date" defaultValue={guest.dob ?? ""} error={fieldError("dob")}
              hint="Age is derived from this." />
            <Field name="gender" label="Gender" defaultValue={guest.gender ?? ""} error={fieldError("gender")} />
            <Field name="nationality" label="Nationality" defaultValue={guest.nationality ?? ""} error={fieldError("nationality")} />
          </div>
          <Field name="occupation" label="Occupation" defaultValue={guest.occupation ?? ""} error={fieldError("occupation")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Contact</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Field name="mobile" label="Mobile" inputMode="tel" maxLength={13} error={fieldError("mobile")}
            placeholder={guest.maskedMobile ?? "Not set"} hint="Leave blank to keep the current number; type to correct it." />
          <Field name="whatsapp" label="WhatsApp" inputMode="tel" maxLength={13} error={fieldError("whatsapp")}
            placeholder={guest.maskedWhatsapp ?? "Not set"} hint="Leave blank to keep unchanged." />
          <Field name="email" label="Email" type="email" inputMode="email" error={fieldError("email")}
            placeholder={guest.maskedEmail ?? "Not set"} hint="Leave blank to keep unchanged." />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Address</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Field name="addressLine" label="Address" defaultValue={guest.addressLine ?? ""} error={fieldError("addressLine")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="city" label="City" defaultValue={guest.city ?? ""} error={fieldError("city")} />
            <Field name="state" label="State" defaultValue={guest.state ?? ""} error={fieldError("state")} />
            <Field name="country" label="Country" defaultValue={guest.country ?? ""} error={fieldError("country")} />
            <Field name="pincode" label="PIN code" inputMode="numeric" defaultValue={guest.pincode ?? ""} error={fieldError("pincode")} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Company &amp; stay</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="companyName" label="Company" defaultValue={guest.companyName ?? ""} error={fieldError("companyName")} />
            <Field name="gstNumber" label="GSTIN" defaultValue={guest.gstNumber ?? ""} error={fieldError("gstNumber")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="purposeOfVisit" label="Purpose of visit" defaultValue={guest.purposeOfVisit ?? ""} error={fieldError("purposeOfVisit")} />
            <Field name="foodPreference" label="Food preference" defaultValue={guest.foodPreference ?? ""} error={fieldError("foodPreference")} />
          </div>
          <TextArea name="specialRequests" label="Special requests" defaultValue={guest.specialRequests ?? ""} error={fieldError("specialRequests")} />
          <TextArea name="medicalNotes" label="Medical notes" defaultValue={guest.medicalNotes ?? ""} error={fieldError("medicalNotes")} />
        </CardContent>
      </Card>

      {state.status === "error" && <p role="alert" className="text-sm text-destructive">{state.message}</p>}

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" size="lg" disabled={pending} className="sm:min-w-40" data-testid="update-guest-submit">
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href={`/guests/${guest.id}`}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  error,
  hint,
  required,
  ...rest
}: {
  name: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name">) {
  const describedBy = [error ? `${name}-error` : null, hint ? `${name}-hint` : null].filter(Boolean).join(" ");
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-0.5">
        <Label htmlFor={name}>{label}</Label>
        {required && <span aria-hidden="true" className="text-destructive">*</span>}
      </div>
      <Input id={name} name={name} required={required} aria-invalid={Boolean(error)} aria-describedby={describedBy || undefined} {...rest} />
      {hint && !error && <p id={`${name}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={`${name}-error`} role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function TextArea({
  name,
  label,
  error,
  defaultValue,
}: {
  name: string;
  label: string;
  error?: string;
  defaultValue?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <textarea
        id={name}
        name={name}
        defaultValue={defaultValue}
        rows={2}
        aria-invalid={Boolean(error)}
        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      />
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
