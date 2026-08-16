"use client";
/**
 * Shared guest profile form — used by the post-signup "welcome" step (capture a
 * name so a phone-only account stops showing "Guest") and the account "edit
 * profile" page. Name is required; email is optional (blank leaves it unchanged).
 */
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfileFormAction } from "../form-actions";
import { GUEST_FORM_IDLE, type GuestFormState } from "../form-state";

function ErrorLine({ state }: { state: GuestFormState }) {
  if (state.status !== "error") return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {state.message}
    </p>
  );
}

export function ProfileForm({
  next = "/account",
  defaultName = "",
  currentEmailMasked = null,
  submitLabel = "Save",
}: {
  next?: string;
  defaultName?: string;
  currentEmailMasked?: string | null;
  submitLabel?: string;
}) {
  const [state, submit, pending] = useActionState(updateProfileFormAction, GUEST_FORM_IDLE);
  const nameError = state.status === "error" ? state.fieldErrors?.fullName : undefined;
  const emailError = state.status === "error" ? state.fieldErrors?.email : undefined;

  return (
    <form action={submit} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <div className="space-y-1.5">
        <Label htmlFor="fullName">Full name</Label>
        <Input
          id="fullName"
          name="fullName"
          autoComplete="name"
          defaultValue={defaultName}
          placeholder="e.g. Aarav Sharma"
          required
          aria-invalid={Boolean(nameError)}
        />
        {nameError?.[0] && <p className="text-xs text-destructive">{nameError[0]}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">
          Email <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="email"
          placeholder={currentEmailMasked ?? "you@example.com"}
          aria-invalid={Boolean(emailError)}
        />
        <p className="text-xs text-muted-foreground">
          {currentEmailMasked
            ? "Leave blank to keep your current email. We use it for booking confirmations."
            : "Add one to get booking confirmations by email too."}
        </p>
        {emailError?.[0] && <p className="text-xs text-destructive">{emailError[0]}</p>}
      </div>

      <ErrorLine state={state} />

      <Button type="submit" block size="lg" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
