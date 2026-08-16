"use client";
/**
 * Guest email sign-up (Phase 2). Captures name + email + password + mobile so the
 * account links to one CRM Guest. Phone-first users don't need this — they just
 * enter a number on the sign-in tab.
 */
import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { signUpEmailFormAction } from "../form-actions";
import { GUEST_FORM_IDLE } from "../form-state";

export function GuestSignUpForm({ next }: { next?: string }) {
  const [state, submit, pending] = useActionState(signUpEmailFormAction, GUEST_FORM_IDLE);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <form action={submit} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />

      <div className="space-y-1.5">
        <Label htmlFor="fullName">Full name</Label>
        <Input id="fullName" name="fullName" autoComplete="name" required aria-invalid={Boolean(fieldErrors?.fullName)} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="mobile">Mobile number</Label>
        <Input
          id="mobile"
          name="mobile"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="9876543210"
          required
          aria-invalid={Boolean(fieldErrors?.mobile)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          required
          aria-invalid={Boolean(fieldErrors?.email)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(fieldErrors?.password)}
        />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>

      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}

      <Button type="submit" block size="lg" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={next ? `/account/sign-in?next=${encodeURIComponent(next)}` : "/account/sign-in"}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
