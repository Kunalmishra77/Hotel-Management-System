"use client";

/**
 * Property create/edit form — 01 T-14 (AC-1/2/3/10).
 *
 * design.md groups the fields: Identity · Address · Tax · Owner · Timezone.
 * GSTIN is validated client-side on blur for immediate feedback, and again on
 * the server — the client check is a courtesy, never the guard.
 */
import { useActionState, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { validateGstin } from "../domain/gstin";
import {
  createPropertyFormAction,
  updatePropertyFormAction,
  type PropertyFormState,
} from "../form-actions";

const INITIAL: PropertyFormState = { status: "idle" };

export type PropertyFormValues = {
  id?: string;
  name?: string;
  code?: string;
  addressLine1?: string;
  addressLine2?: string | null;
  city?: string;
  state?: string;
  country?: string;
  pincode?: string;
  timezone?: string;
  gstin?: string | null;
  ownerName?: string | null;
  ownerContact?: string | null;
};

export function PropertyForm({ initial }: { initial?: PropertyFormValues }) {
  const isEdit = Boolean(initial?.id);
  const [state, submit, pending] = useActionState(
    isEdit ? updatePropertyFormAction : createPropertyFormAction,
    INITIAL,
  );
  const [gstinError, setGstinError] = useState<string | null>(null);

  const fieldError = (name: string): string | undefined =>
    state.status === "error" ? state.fieldErrors?.[name]?.[0] : undefined;

  return (
    <form action={submit} className="space-y-4">
      {isEdit && <input type="hidden" name="id" value={initial!.id} />}

      <Section title="Identity">
        <Field
          name="name"
          label="Property name"
          defaultValue={initial?.name}
          error={fieldError("name")}
          required
          autoFocus={!isEdit}
        />
        <Field
          name="code"
          label="Code"
          defaultValue={initial?.code}
          error={fieldError("code")}
          required
          maxLength={8}
          // Feeds gap-free invoice numbering per property/FY (06 FR-13).
          hint="Short code used in invoice numbers, e.g. WMG."
          className="uppercase"
        />
      </Section>

      <Section title="Address">
        <Field
          name="addressLine1"
          label="Address line 1"
          defaultValue={initial?.addressLine1}
          error={fieldError("addressLine1")}
          required
        />
        <Field
          name="addressLine2"
          label="Address line 2"
          defaultValue={initial?.addressLine2 ?? ""}
          error={fieldError("addressLine2")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="city"
            label="City"
            defaultValue={initial?.city}
            error={fieldError("city")}
            required
          />
          <Field
            name="state"
            label="State"
            defaultValue={initial?.state}
            error={fieldError("state")}
            required
            hint="Determines GST place of supply."
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="pincode"
            label="PIN code"
            defaultValue={initial?.pincode}
            error={fieldError("pincode")}
            required
            inputMode="numeric"
            maxLength={6}
          />
          <Field
            name="country"
            label="Country"
            defaultValue={initial?.country ?? "India"}
            error={fieldError("country")}
          />
        </div>
      </Section>

      <Section title="Tax">
        <Field
          name="gstin"
          label="GSTIN"
          defaultValue={initial?.gstin ?? ""}
          error={gstinError ?? fieldError("gstin")}
          maxLength={15}
          className="uppercase"
          hint="Optional. 15 characters, including the check digit."
          onBlur={(value) => {
            // Immediate feedback; the server validates again regardless.
            const result = validateGstin(value);
            setGstinError(result.ok ? null : result.error);
          }}
        />
      </Section>

      <Section title="Owner & timezone">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="ownerName"
            label="Owner name"
            defaultValue={initial?.ownerName ?? ""}
            error={fieldError("ownerName")}
          />
          <Field
            name="ownerContact"
            label="Owner contact"
            defaultValue={initial?.ownerContact ?? ""}
            error={fieldError("ownerContact")}
            inputMode="tel"
          />
        </div>
        <Field
          name="timezone"
          label="Timezone"
          defaultValue={initial?.timezone ?? "Asia/Kolkata"}
          error={fieldError("timezone")}
          required
          hint="Sets the property's business day and night-audit boundary."
        />
      </Section>

      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" size="lg" disabled={pending} className="sm:min-w-40">
          {pending ? "Saving…" : isEdit ? "Save changes" : "Create property"}
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href={isEdit ? `/properties/${initial!.id}` : "/properties"}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function Field({
  name,
  label,
  defaultValue,
  error,
  hint,
  required,
  className,
  onBlur,
  ...rest
}: {
  name: string;
  label: string;
  defaultValue?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  onBlur?: (value: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onBlur" | "name" | "defaultValue">) {
  const describedBy = [error ? `${name}-error` : null, hint ? `${name}-hint` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-1.5">
      {/*
       * The asterisk sits OUTSIDE <Label> deliberately. Inside, it becomes part
       * of the label's text content — the field's accessible name turns into
       * "Code*", which a screen reader announces as "Code asterisk" and which
       * also makes "Code" ambiguous against "PIN code". `aria-hidden` on a child
       * span is not enough: the text still belongs to the label element.
       * `required` on the input already conveys the state to assistive tech.
       */}
      <div className="flex items-center gap-0.5">
        <Label htmlFor={name}>{label}</Label>
        {required && (
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
        )}
      </div>
      <Input
        id={name}
        name={name}
        defaultValue={defaultValue}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy || undefined}
        className={cn(className)}
        onBlur={onBlur ? (e) => onBlur(e.target.value) : undefined}
        {...rest}
      />
      {hint && !error && (
        <p id={`${name}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${name}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
