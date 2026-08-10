"use client";

/**
 * Sign-in + 2FA challenge — 00 T-22 (AC-1/AC-2/AC-3), design.md § UI wireframes.
 *
 * One component holds both steps because they share a single state machine:
 * step two is entered only when step one returns a challenge, and a wrong code
 * must not throw the user back to re-entering their password.
 */
import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { signInAction, verifyTotpAction, type SignInState } from "../actions";

const INITIAL: SignInState = { status: "idle" };

/**
 * Portal → its demo login. Clicking a portal on the landing opens THIS form with
 * the role's context + email prefilled (the email still editable — anyone can sign
 * in). Password is always typed; real RBAC decides the portal after login.
 */
const PORTAL_LOGINS: Record<string, { label: string; email: string }> = {
  administrator: { label: "Administrator", email: "admin@woodpecker.example" },
  manager: { label: "Manager", email: "manager.mg@woodpecker.example" },
  reception: { label: "Reception", email: "reception.mg@woodpecker.example" },
  accounts: { label: "Accounts", email: "accounts@woodpecker.example" },
  housekeeping: { label: "Housekeeping", email: "housekeeping.mg@woodpecker.example" },
  maintenance: { label: "Maintenance", email: "maintenance.mg@woodpecker.example" },
  owner: { label: "Property Owner", email: "owner.mg@woodpecker.example" },
};

export function SignInForm({ next, justReset, role }: { next?: string; justReset?: boolean; role?: string }) {
  const [state, submitCredentials, credentialsPending] = useActionState(signInAction, INITIAL);
  const portal = role ? PORTAL_LOGINS[role] : undefined;

  if (state.status === "totp_required" || state.status === "totp_error") {
    return <TotpStep challenge={state.challenge} next={next} state={state} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{portal ? `Sign in — ${portal.label}` : "Sign in"}</CardTitle>
        <CardDescription>
          {portal ? `You're entering the ${portal.label} portal. Use your work email.` : "Use your work email address."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {justReset && (
          <p
            role="status"
            className="mb-4 rounded-md border border-success/30 bg-success/10 p-3 text-sm text-foreground"
          >
            Your password has been changed. Sign in with your new password.
          </p>
        )}

        <form action={submitCredentials} className="space-y-4">
          <input type="hidden" name="next" value={next ?? ""} />

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
              defaultValue={portal?.email}
              aria-invalid={Boolean(state.status === "error" && state.fieldErrors?.email)}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="current-password"
              required
              aria-invalid={Boolean(state.status === "error" && state.fieldErrors?.password)}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id="remember" name="remember" />
            <Label htmlFor="remember" className="cursor-pointer text-sm font-normal text-muted-foreground">
              Keep me signed in on this device
            </Label>
          </div>

          {state.status === "error" && (
            <p role="alert" className="text-sm text-destructive">
              {state.message}
            </p>
          )}

          <Button type="submit" block size="lg" disabled={credentialsPending}>
            {credentialsPending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function TotpStep({
  challenge,
  next,
  state,
}: {
  challenge: string;
  next?: string;
  state: SignInState;
}) {
  const [totpState, submitTotp, pending] = useActionState(verifyTotpAction, state);
  const activeChallenge =
    totpState.status === "totp_required" || totpState.status === "totp_error"
      ? totpState.challenge
      : challenge;

  const message =
    totpState.status === "totp_error"
      ? totpState.message
      : totpState.status === "error"
        ? totpState.message
        : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-factor code</CardTitle>
        <CardDescription>Enter the 6-digit code from your authenticator app.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={submitTotp} className="space-y-4">
          <input type="hidden" name="challenge" value={activeChallenge} />
          <input type="hidden" name="next" value={next ?? ""} />

          <div className="space-y-1.5">
            <Label htmlFor="code">Code</Label>
            <Input
              id="code"
              name="code"
              // Numeric keypad for the 6-digit case; still accepts a backup code.
              inputMode="numeric"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              autoCorrect="off"
              autoFocus
              required
              placeholder="123456"
              className="text-center text-2xl tracking-[0.4em]"
              aria-invalid={totpState.status === "totp_error"}
            />
            <p className="text-xs text-muted-foreground">
              Lost your device? Enter one of your backup codes instead.
            </p>
          </div>

          {message && (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}

          <Button type="submit" block size="lg" disabled={pending}>
            {pending ? "Verifying…" : "Verify"}
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
