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
import { AuthPanel } from "./auth-panel";
import { requestPasswordResetAction, type ResetRequestState } from "../password-actions";

const INITIAL: ResetRequestState = { status: "idle" };

export function ForgotPasswordForm() {
  const [state, submit, pending] = useActionState(requestPasswordResetAction, INITIAL);

  if (state.status === "sent") {
    return (
      <AuthPanel title="Check your email" description={<>If that address has an account, a reset link is on its way. The link expires in one
            hour.</>}>
          <Button asChild block variant="outline">
            <Link href="/sign-in">Back to sign in</Link>
          </Button>
        </AuthPanel>
    );
  }

  return (
    <AuthPanel title="Reset your password" description={<>We&apos;ll email you a link to set a new one.</>}>
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

          <Button type="submit" block size="lg" disabled={pending} className="bg-brand-pine text-brand-pine-foreground hover:bg-brand-pine/90">
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
      </AuthPanel>
  );
}
