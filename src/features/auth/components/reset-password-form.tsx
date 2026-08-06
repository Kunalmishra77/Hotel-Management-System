"use client";

/**
 * Redeem a reset token — 00 T-22 (FR-6, AC-6).
 */
import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { resetPasswordAction, type ResetState } from "../password-actions";

const INITIAL: ResetState = { status: "idle" };

export function ResetPasswordForm({
  token,
  minLength,
}: {
  token: string;
  minLength: number;
}) {
  const [state, submit, pending] = useActionState(resetPasswordAction, INITIAL);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>
          At least {minLength} characters. Signing in again on your other devices will be
          required.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={submit} className="space-y-4">
          <input type="hidden" name="token" value={token} />

          <div className="space-y-1.5">
            <Label htmlFor="password">New password</Label>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="new-password"
              minLength={minLength}
              required
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <PasswordInput
              id="confirmPassword"
              name="confirmPassword"
              autoComplete="new-password"
              minLength={minLength}
              required
            />
          </div>

          {state.status === "error" && (
            <p role="alert" className="text-sm text-destructive">
              {state.message}
            </p>
          )}

          <Button type="submit" block size="lg" disabled={pending}>
            {pending ? "Saving…" : "Set new password"}
          </Button>

          <p className="text-center">
            <Link
              href="/sign-in"
              className="inline-flex min-h-touch items-center text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              ‹ Back to sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
