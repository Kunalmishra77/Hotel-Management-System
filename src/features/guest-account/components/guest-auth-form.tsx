"use client";
/**
 * Guest sign-in — phone (OTP) and email tabs (Phase 2). The phone tab is a small
 * two-step machine (enter number → enter code) mirroring the staff 2FA pattern:
 * a wrong code must not throw the user back to re-entering their number.
 */
import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  requestPhoneOtpFormAction,
  verifyPhoneOtpFormAction,
  logInEmailFormAction,
  GUEST_FORM_IDLE,
  type GuestFormState,
} from "../form-actions";

function ErrorLine({ state }: { state: GuestFormState }) {
  if (state.status !== "error") return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {state.message}
    </p>
  );
}

export function GuestAuthForm({ next }: { next?: string }) {
  return (
    <Tabs defaultValue="phone" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="phone">Phone OTP</TabsTrigger>
        <TabsTrigger value="email">Email</TabsTrigger>
      </TabsList>

      <TabsContent value="phone" className="mt-5">
        <PhoneTab next={next} />
      </TabsContent>

      <TabsContent value="email" className="mt-5">
        <EmailTab next={next} />
      </TabsContent>
    </Tabs>
  );
}

function PhoneTab({ next }: { next?: string }) {
  const [reqState, requestOtp, requesting] = useActionState(requestPhoneOtpFormAction, GUEST_FORM_IDLE);

  if (reqState.status === "otp_sent") {
    return <OtpStep mobile={reqState.mobile} devCode={reqState.devCode} next={next} />;
  }

  return (
    <form action={requestOtp} className="space-y-4">
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
          aria-invalid={Boolean(reqState.status === "error" && reqState.fieldErrors?.mobile)}
        />
        <p className="text-xs text-muted-foreground">
          New here? Entering your number creates your account — no password needed.
        </p>
      </div>
      <ErrorLine state={reqState} />
      <Button type="submit" block size="lg" disabled={requesting}>
        {requesting ? "Sending code…" : "Send OTP"}
      </Button>
    </form>
  );
}

function OtpStep({ mobile, devCode, next }: { mobile: string; devCode?: string; next?: string }) {
  const [state, verify, verifying] = useActionState(verifyPhoneOtpFormAction, GUEST_FORM_IDLE);

  return (
    <form action={verify} className="space-y-4">
      <input type="hidden" name="mobile" value={mobile} />
      <input type="hidden" name="next" value={next ?? ""} />

      {devCode && (
        <p role="status" className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
          Demo mode — your code is <span className="font-semibold tracking-wider">{devCode}</span>. (Live SMS
          arrives once the gateway is activated.)
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="code">Enter the 6-digit code</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          required
          placeholder="123456"
          className="text-center text-2xl tracking-[0.4em]"
          aria-invalid={state.status === "error"}
        />
        <p className="text-xs text-muted-foreground">Sent to {mobile}. It expires in 10 minutes.</p>
      </div>

      <ErrorLine state={state} />

      <Button type="submit" block size="lg" disabled={verifying}>
        {verifying ? "Verifying…" : "Verify & continue"}
      </Button>
    </form>
  );
}

function EmailTab({ next }: { next?: string }) {
  const [state, submit, pending] = useActionState(logInEmailFormAction, GUEST_FORM_IDLE);

  return (
    <form action={submit} className="space-y-4">
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
          aria-invalid={Boolean(state.status === "error" && state.fieldErrors?.email)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <PasswordInput id="password" name="password" autoComplete="current-password" required />
      </div>

      <ErrorLine state={state} />

      <Button type="submit" block size="lg" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        New guest?{" "}
        <Link
          href={next ? `/account/sign-up?next=${encodeURIComponent(next)}` : "/account/sign-up"}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
