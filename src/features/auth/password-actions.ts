"use server";

/**
 * Password-reset server actions — 00 T-22 (FR-6, AC-6).
 *
 * Split from `actions.ts` to keep each file under the ~300-line limit in
 * coding-standards.md and to give the reset flow one clear home.
 */
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import {
  issuePasswordResetToken,
  redeemPasswordResetToken,
} from "@/lib/auth/password-reset";
import { hashPassword, passwordIssues, verifyPassword } from "@/lib/auth/password";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { logger } from "@/lib/logger";
import { changePasswordSchema, requestPasswordResetSchema, resetPasswordSchema } from "./schema";
import { authDb, withUserContext } from "./internal";

export type ResetRequestState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "error"; message: string };

/**
 * Request a reset link (FR-6).
 *
 * Always reports "sent", even for an unknown email — anything else is an
 * account-enumeration oracle, the same hole FR-4 closes on the sign-in path.
 */
export async function requestPasswordResetAction(
  _prev: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const parsed = requestPasswordResetSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { status: "error", message: "Enter a valid email address." };

  const issued = await issuePasswordResetToken(authDb, parsed.data.email);

  if (issued) {
    // Delivery is module 12's job. Until a messaging adapter is registered the
    // link is logged — exactly the sandbox behaviour integrations.md prescribes,
    // so dev/CI works with zero external accounts.
    logger.info("password_reset.issued", {
      resetUrl: `${process.env.APP_URL ?? ""}/reset-password?token=${issued.token}`,
      expiresAt: issued.expiresAt.toISOString(),
    });
  }

  return { status: "sent" };
}

export type ResetState = { status: "idle" } | { status: "error"; message: string };

/** Redeem a reset token and set the new password (FR-6, AC-6). */
export async function resetPasswordAction(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
    return { status: "error", message: first ?? "Please check the highlighted fields." };
  }

  const outcome = await redeemPasswordResetToken(
    authDb,
    parsed.data.token,
    parsed.data.password,
  );

  if (outcome.kind === "TOKEN_INVALID") {
    return { status: "error", message: "This link is invalid or has expired." };
  }
  if (outcome.kind === "WEAK_PASSWORD") {
    return { status: "error", message: outcome.issues[0] ?? "Choose a stronger password." };
  }

  const user = await authDb.user.findUniqueOrThrow({
    where: { id: outcome.userId },
    select: { orgId: true },
  });

  await withUserContext(user.orgId, outcome.userId, () =>
    authDb.$transaction(async (tx) => {
      await emitEvent(tx, {
        type: "SessionForceLoggedOut",
        aggregateId: outcome.userId,
        payload: { reason: "password-reset", sessionsRevoked: outcome.sessionsRevoked },
      });
      await writeAudit(tx, {
        action: "auth:password-reset",
        entityType: "User",
        entityId: outcome.userId,
        after: { sessionsRevoked: outcome.sessionsRevoked },
      });
    }),
  );

  redirect("/sign-in?reset=1");
}

export type ChangePasswordState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

/**
 * Change password for a signed-in user (auth standard). Verifies the current
 * password, applies the org's length policy, and — on success — signs out every
 * OTHER device while keeping this one, so a leaked session elsewhere dies.
 */
export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const session = await getCurrentSession();
  if (!session) return { status: "error", message: "Your session has expired. Please sign in again." };

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    const first = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
    return { status: "error", message: first ?? "Please check the highlighted fields." };
  }

  const { claims, sessionId } = session;
  const user = await authDb.user.findUnique({
    where: { id: claims.userId },
    select: { passwordHash: true },
  });
  if (!user) return { status: "error", message: "Your session has expired. Please sign in again." };

  if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    return { status: "error", message: "Your current password is incorrect." };
  }

  const settings = await authDb.securitySettings.findUnique({
    where: { orgId: claims.orgId },
    select: { passwordMinLength: true },
  });
  const issues = passwordIssues(parsed.data.password, settings?.passwordMinLength ?? 10);
  if (issues.length > 0) return { status: "error", message: issues[0]! };

  if (await verifyPassword(parsed.data.password, user.passwordHash)) {
    return { status: "error", message: "Choose a password different from your current one." };
  }

  const newHash = await hashPassword(parsed.data.password);

  await withUserContext(claims.orgId, claims.userId, () =>
    authDb.$transaction(async (tx) => {
      await tx.user.update({ where: { id: claims.userId }, data: { passwordHash: newHash } });
      const revoked = await tx.session.updateMany({
        where: { userId: claims.userId, revokedAt: null, NOT: { id: sessionId } },
        data: { revokedAt: new Date() },
      });
      await emitEvent(tx, {
        type: "SessionForceLoggedOut",
        aggregateId: claims.userId,
        payload: { reason: "password-change", sessionsRevoked: revoked.count },
      });
      await writeAudit(tx, {
        action: "auth:password-change",
        entityType: "User",
        entityId: claims.userId,
        after: { sessionsRevoked: revoked.count },
      });
    }),
  );

  return { status: "success" };
}
