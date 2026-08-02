"use client";

/**
 * Request a reset link — 00 T-22 (FR-6, AC-6).
 *
 * The success message is shown for ANY submitted address, including one that
 * does not exist. Confirming which emails have accounts would hand an attacker
 * the user list.
 */
import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requestPasswordResetAction, type ResetRequestState } from "../password-actions";

const INITIAL: ResetRequestState = { status: "idle" };

export function ForgotPasswordForm() {
  const [state, submit, pending] = useActionState(requestPasswordResetAction, INITIAL);

  if (state.status === "sent") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
          <CardDescription>
            If that address has an account, a reset link is on its way. The link expires in one
            hour.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild block variant="outline">
            <Link href="/sign-in">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>We&apos;ll email you a link to set a new one.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              required
            />
          </div>

          {state.status === "error" && (
            <p role="alert" className="text-sm text-destructive">
              {state.message}
            </p>
          )}

          <Button type="submit" block size="lg" disabled={pending}>
            {pending ? "Sending…" : "Send reset link"}
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
