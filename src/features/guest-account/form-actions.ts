"use server";
/**
 * useActionState-friendly wrappers over the guest-account actions (Phase 2).
 * The client forms speak `(prevState, formData) → GuestFormState`; the underlying
 * actions speak `Result<T>`. On success we redirect into the guest area; on
 * failure we surface a user-safe message + field errors (never a raw throw).
 */
import { redirect } from "next/navigation";
import { signUpEmail, logInEmail, requestPhoneOtp, verifyPhoneOtp } from "./actions";

export type GuestFormState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> }
  | { status: "otp_sent"; mobile: string; devCode?: string };

const IDLE: GuestFormState = { status: "idle" };

/** Only same-origin relative paths are honoured as a post-login destination. */
function safeNext(raw: FormDataEntryValue | null): string {
  const v = typeof raw === "string" ? raw : "";
  return v.startsWith("/") && !v.startsWith("//") ? v : "/account";
}

function errorState(error: { message: string; fieldErrors?: Record<string, string[]> }): GuestFormState {
  return { status: "error", message: error.message, fieldErrors: error.fieldErrors };
}

export async function signUpEmailFormAction(
  _prev: GuestFormState,
  formData: FormData,
): Promise<GuestFormState> {
  const res = await signUpEmail({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    mobile: formData.get("mobile"),
  });
  if (!res.ok) return errorState(res.error);
  redirect(safeNext(formData.get("next")));
}

export async function logInEmailFormAction(
  _prev: GuestFormState,
  formData: FormData,
): Promise<GuestFormState> {
  const res = await logInEmail({ email: formData.get("email"), password: formData.get("password") });
  if (!res.ok) return errorState(res.error);
  redirect(safeNext(formData.get("next")));
}

export async function requestPhoneOtpFormAction(
  _prev: GuestFormState,
  formData: FormData,
): Promise<GuestFormState> {
  const mobile = String(formData.get("mobile") ?? "");
  const res = await requestPhoneOtp({ mobile, fullName: formData.get("fullName") ?? undefined });
  if (!res.ok) return errorState(res.error);
  return { status: "otp_sent", mobile, devCode: res.data.devCode };
}

export async function verifyPhoneOtpFormAction(
  _prev: GuestFormState,
  formData: FormData,
): Promise<GuestFormState> {
  const res = await verifyPhoneOtp({
    mobile: formData.get("mobile"),
    code: formData.get("code"),
    fullName: formData.get("fullName") ?? undefined,
  });
  if (!res.ok) return errorState(res.error);
  redirect(safeNext(formData.get("next")));
}

export { IDLE as GUEST_FORM_IDLE };
