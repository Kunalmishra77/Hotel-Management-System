"use client";

/**
 * New-guest form + duplicate-resolution sheet — 04 T-20 (FR-1/5, AC-1/3).
 *
 * On submit the server action creates the guest, or — if it detects a probable
 * duplicate — returns the MASKED candidates. We then show a sheet: the user can
 * open an existing guest, or "Create anyway", which resubmits the same values
 * with `confirmDuplicate` set. Mobile is required and validated server-side
 * (FR-2); the client input mode just speeds one-thumb entry.
 */
import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createGuestFormAction, type GuestFormState } from "../form-actions";

const INITIAL: GuestFormState = { status: "idle" };

export function NewGuestForm() {
  const [state, submit, pending] = useActionState(createGuestFormAction, INITIAL);
  const fieldError = (name: string) =>
    state.status === "error" ? state.fieldErrors?.[name]?.[0] : undefined;
  const draft = state.status === "duplicate" ? state.draft : undefined;

  return (
    <form action={submit} className="space-y-4" data-testid="new-guest-form">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Guest details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field name="fullName" label="Full name" required autoFocus defaultValue={draft?.fullName}
            error={fieldError("fullName")} />
          <Field name="mobile" label="Mobile" required inputMode="tel" maxLength={13}
            defaultValue={draft?.mobile} error={fieldError("mobile")}
            hint="Indian mobile — used to spot duplicates." />
          <Field name="email" label="Email" type="email" inputMode="email"
            defaultValue={draft?.email} error={fieldError("email")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="city" label="City" defaultValue={draft?.city} error={fieldError("city")} />
            <Field name="companyName" label="Company" defaultValue={draft?.companyName}
              error={fieldError("companyName")} />
          </div>
        </CardContent>
      </Card>

      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive">{state.message}</p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" size="lg" disabled={pending} className="sm:min-w-40"
          data-testid="create-guest-submit">
          {pending ? "Saving…" : "Create guest"}
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/guests">Cancel</Link>
        </Button>
      </div>

      {state.status === "duplicate" && <DuplicateSheet state={state} pending={pending} />}
    </form>
  );
}

/**
 * The resolution sheet. It renders INSIDE the form so its hidden inputs +
 * `confirmDuplicate` submit button reuse the same action — "Create anyway" is
 * just the same submission with the guard lifted.
 */
function DuplicateSheet({
  state,
  pending,
}: {
  state: Extract<GuestFormState, { status: "duplicate" }>;
  pending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Possible duplicate guest"
        data-testid="duplicate-sheet"
        className="relative w-full rounded-t-xl border bg-background p-4 shadow-lg pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:max-w-md sm:rounded-xl sm:pb-4"
      >
        <h2 className="text-lg font-semibold">This guest may already exist</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A guest with matching contact details was found. Open the existing record, or create a
          new one anyway.
        </p>

        <ul className="mt-3 divide-y rounded-md border">
          {state.candidates.map((c) => (
            <li key={c.id}>
              <Link href={`/guests/${c.id}`} className="flex min-h-11 items-center justify-between p-3 hover:bg-muted/50"
                data-testid="duplicate-candidate">
                <span className="font-medium">{c.fullName}</span>
                <span className="text-sm text-muted-foreground">
                  {c.maskedMobile ?? "—"}{c.city ? ` · ${c.city}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        {/* Re-submit the SAME draft, this time past the dedupe gate. */}
        <input type="hidden" name="confirmDuplicate" value="true" />
        <input type="hidden" name="fullName" value={state.draft.fullName} />
        <input type="hidden" name="mobile" value={state.draft.mobile} />
        <input type="hidden" name="email" value={state.draft.email} />
        <input type="hidden" name="city" value={state.draft.city} />
        <input type="hidden" name="companyName" value={state.draft.companyName} />

        <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
          <Button type="submit" size="lg" variant="destructive" disabled={pending}
            data-testid="create-anyway">
            Create anyway
          </Button>
        </div>
      </div>
    </div>
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
  const describedBy = [error ? `${name}-error` : null, hint ? `${name}-hint` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-0.5">
        <Label htmlFor={name}>{label}</Label>
        {required && <span aria-hidden="true" className="text-destructive">*</span>}
      </div>
      <Input id={name} name={name} required={required} aria-invalid={Boolean(error)}
        aria-describedby={describedBy || undefined} {...rest} />
      {hint && !error && (
        <p id={`${name}-hint`} className="text-xs text-muted-foreground">{hint}</p>
      )}
      {error && (
        <p id={`${name}-error`} role="alert" className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
