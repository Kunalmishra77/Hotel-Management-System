/**
 * Auth.js v5 — the full (Node runtime) configuration, plus the helpers every
 * server action uses to get an authenticated caller.
 *
 * 00 T-3 (FR-1/FR-2, AC-1). The credentials provider verifies the password with
 * bcrypt and, on success, creates the DB-backed `Session` row; the JWT then
 * carries only that row's opaque token.
 *
 * 2FA (FR-3/FR-5) is enforced here as a hard gate: a user who requires TOTP
 * cannot obtain a session through this provider at all. The two-step challenge
 * flow lands in T-4 — until then, "requires TOTP" means "no session", which is
 * the safe direction to be incomplete in.
 */
import NextAuth, { type NextAuthResult } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { verifyCredentials } from "./credentials";
import { clearFailedAttempts } from "./lockout";
import { verifySecondFactor, verifyTotpChallenge } from "./two-factor";
import { createSession, resolveSession, type ResolvedSession } from "./session";
import { prisma } from "../db/client";
import { logger } from "../logger";
import { UnauthenticatedError } from "../errors";
import type { SessionClaims } from "./claims";

export const signInInputSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

/**
 * The second step of a 2FA sign-in. The challenge is an HMAC-signed token
 * proving the password was ALREADY verified moments ago, so the password never
 * has to be held by the client between the two steps.
 */
export const totpStepSchema = z.object({
  challenge: z.string().min(1),
  code: z.string().trim().min(6).max(14),
});

const result: NextAuthResult = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        challenge: { label: "Challenge", type: "text" },
        code: { label: "Two-factor code", type: "text" },
      },
      /**
       * Accepts either shape:
       *   { email, password }   — a user with no second factor
       *   { challenge, code }   — step two of a 2FA sign-in
       * A session is issued only when every required factor has passed.
       */
      async authorize(raw) {
        const totpStep = totpStepSchema.safeParse(raw);
        if (totpStep.success) return authorizeTotpStep(totpStep.data);

        const parsed = signInInputSchema.safeParse(raw);
        if (!parsed.success) return null;

        const outcome = await verifyCredentials(prisma, parsed.data.email, parsed.data.password);

        if (outcome.kind !== "OK") {
          // Never differentiate to the client (FR-4). The reason is logged
          // server-side only, without the email, for rate-limit forensics.
          logger.warn("signin.rejected", { outcome: outcome.kind });
          return null;
        }

        if (outcome.requiresTotp) {
          // FR-3: withhold the session until the second factor is presented.
          // The UI drives the second step; this provider refuses to issue here.
          logger.info("signin.totp_required", { userId: outcome.userId });
          return null;
        }

        return issue(outcome.userId);
      },
    }),
  ],
});

async function authorizeTotpStep(
  input: z.infer<typeof totpStepSchema>,
): Promise<{ id: string; email: string; name: string; sessionToken: string } | null> {
  const userId = verifyTotpChallenge(input.challenge);
  if (!userId) {
    logger.warn("signin.totp_challenge_invalid");
    return null;
  }

  const second = await verifySecondFactor(prisma, userId, input.code);
  if (second.kind !== "OK") {
    logger.warn("signin.totp_rejected", { userId, outcome: second.kind });
    return null;
  }

  // Named to avoid the logger's "backupcode" redaction pattern — this is a
  // boolean about WHICH factor was used, never a code.
  logger.info("signin.totp_ok", { userId, viaRecoveryCode: second.usedBackupCode });
  return issue(userId);
}

async function issue(
  userId: string,
): Promise<{ id: string; email: string; name: string; sessionToken: string } | null> {
  const session = await createSession(prisma, userId);
  if (!session) return null;
  await clearFailedAttempts(prisma, userId);

  return {
    id: userId,
    email: session.claims.email,
    name: session.claims.name,
    sessionToken: session.token,
  };
}

export const handlers = result.handlers;
export const auth = result.auth;
export const signIn = result.signIn;
export const signOut = result.signOut;

/**
 * The authenticated caller, or null.
 *
 * Two hops on purpose: Auth.js gives us the opaque token, then the database
 * gives us authority. Skipping the second hop would mean trusting a token the
 * client holds — exactly what security.md forbids.
 */
export async function getCurrentSession(): Promise<ResolvedSession | null> {
  const authSession = await auth();
  const token = authSession?.sessionToken;
  if (!token) return null;
  return resolveSession(prisma, token);
}

export async function getCurrentUser(): Promise<SessionClaims | null> {
  return (await getCurrentSession())?.claims ?? null;
}

/**
 * Assert an authenticated caller. Throws `UNAUTHENTICATED` rather than
 * returning null so a forgotten check cannot silently proceed anonymously.
 */
export async function requireSession(): Promise<ResolvedSession> {
  const session = await getCurrentSession();
  if (!session) throw new UnauthenticatedError();
  return session;
}

export async function requireUser(): Promise<SessionClaims> {
  return (await requireSession()).claims;
}

export * from "./claims";
export * from "./credentials";
export * from "./lockout";
export * from "./password";
export * from "./password-reset";
export * from "./session";
export * from "./session-token";
export * from "./totp";
export * from "./two-factor";
