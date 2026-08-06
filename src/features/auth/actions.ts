"use server";

/**
 * Sign-in / sign-out server actions — 00 T-22 (design.md § Application).
 *
 * Every rejection an unauthenticated caller can trigger returns the SAME
 * message (FR-4, AC-4): wrong password, unknown email, locked account and
 * inactive account are indistinguishable from outside. The distinctions exist
 * only in the server log and the audit trail.
 *
 * Password reset lives in `password-actions.ts`; shared helpers in `internal.ts`.
 */
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn as authSignIn, signOut as authSignOut, getCurrentSession } from "@/lib/auth";
import { verifyCredentials } from "@/lib/auth/credentials";
import { issueTotpChallenge, verifyTotpChallenge } from "@/lib/auth/two-factor";
import { recordFailedAttempt } from "@/lib/auth/lockout";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { signInSchema, totpSchema } from "./schema";
import {
  GENERIC_SIGN_IN_ERROR,
  authDb,
  landingRoute,
  recordSignIn,
  withUserContext,
} from "./internal";

export type SignInState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> }
  /** Password accepted; a second factor is required (FR-3). */
  | { status: "totp_required"; challenge: string }
  /** A wrong code — stay on step two rather than sending them back to step one. */
  | { status: "totp_error"; challenge: string; message: string };

/**
 * Step one: verify credentials.
 *
 * On success WITHOUT 2FA this signs in and redirects. On success WITH 2FA it
 * returns a signed challenge and issues no session — so the password never has
 * to be held by the client between the two steps.
 */
export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    remember: formData.get("remember") ?? undefined,
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { email, password, remember, next } = parsed.data;
  const outcome = await verifyCredentials(authDb, email, password);

  if (outcome.kind === "INVALID") {
    // FR-4: count the attempt against a real account so backoff/lockout can
    // engage. An unknown email has no counter to increment — and the response
    // is identical either way, so nothing leaks.
    if (outcome.userId && outcome.orgId) {
      await recordFailedAttempt(authDb, outcome.userId, outcome.orgId);
    }
    return { status: "error", message: GENERIC_SIGN_IN_ERROR };
  }

  if (outcome.kind === "LOCKED") {
    // Same wording as a wrong password — a distinct message would confirm the
    // account exists (FR-4).
    logger.warn("signin.locked", { userId: outcome.userId });
    return { status: "error", message: GENERIC_SIGN_IN_ERROR };
  }

  if (outcome.kind === "INACTIVE") {
    logger.warn("signin.inactive", { userId: outcome.userId });
    return { status: "error", message: GENERIC_SIGN_IN_ERROR };
  }

  if (outcome.requiresTotp) {
    return { status: "totp_required", challenge: issueTotpChallenge(outcome.userId) };
  }

  try {
    await authSignIn("credentials", {
      email,
      password,
      remember: remember ? "1" : "",
      redirect: false,
    });
  } catch (e) {
    if (e instanceof AuthError) return { status: "error", message: GENERIC_SIGN_IN_ERROR };
    throw e;
  }

  await recordSignIn(outcome.userId, outcome.orgId, false);
  redirect(await landingRoute(outcome.userId, next));
}

/** Step two: the TOTP or backup code (AC-2/AC-3). */
export async function verifyTotpAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = totpSchema.safeParse({
    challenge: formData.get("challenge"),
    code: formData.get("code"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Enter the code from your authenticator app.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { challenge, code, next } = parsed.data;

  // Resolve the actor from the challenge BEFORE signing in. The session cookie
  // is written to the OUTGOING response, so `auth()` in this same request still
  // sees the pre-sign-in cookies — reading the session back here would always
  // find nothing and reject a sign-in that actually succeeded.
  const userId = verifyTotpChallenge(challenge);
  if (!userId) {
    return {
      status: "error",
      message: "That sign-in attempt expired. Please enter your password again.",
    };
  }

  try {
    await authSignIn("credentials", { challenge, code, redirect: false });
  } catch (e) {
    if (e instanceof AuthError) {
      // Keep the challenge so the user can retry without re-entering their
      // password — it is valid until its short TTL expires.
      return { status: "totp_error", challenge, message: "That code isn't valid. Try again." };
    }
    throw e;
  }

  const user = await authDb.user.findUnique({
    where: { id: userId },
    select: { orgId: true },
  });
  if (user) await recordSignIn(userId, user.orgId, true);

  redirect(await landingRoute(userId, next));
}

export async function signOutAction(): Promise<never> {
  const session = await getCurrentSession();

  if (session) {
    // Revoke the DB row as well as clearing the cookie: a cookie the client
    // still holds must stop working immediately (security.md).
    const { claims, sessionId } = session;
    await withUserContext(claims.orgId, claims.userId, async () => {
      await authDb.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await authDb.$transaction((tx) =>
        writeAudit(tx, {
          action: "auth:sign-out",
          entityType: "Session",
          entityId: sessionId,
        }),
      );
    });
  }

  await authSignOut({ redirect: false });
  redirect("/sign-in");
}
