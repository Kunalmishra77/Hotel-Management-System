"use server";
/**
 * Guest-account server actions (Phase 2, customer redesign).
 *
 * The customer product's auth surface — completely separate from staff auth. Two
 * paths land on one CRM `Guest` (deduped by contact): email+password (explicit
 * signup/login) and phone-OTP (unified signup+login). Every action:
 *   validate → run in system context → work in a transaction → audit + event →
 *   set the guest cookie → typed Result.
 * A guest holds no role, no property scope, and can never reach `(dashboard)`.
 *
 * Anti-enumeration: credential failures return an identical INVALID_CREDENTIALS
 * with equalised timing, exactly like staff sign-in (security.md FR-4).
 */
import { DomainError, ErrorCode, ConflictError } from "@/lib/errors";
import { type Result, toResult } from "@/lib/result";
import { db } from "@/lib/db";
import { runWithSystemContext } from "@/lib/context";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  createGuestSession,
  revokeGuestSession,
  resolveGuestSession,
  mobileHashOf,
  emailHashOf,
  normalizeMobile,
  generateOtpCode,
  hashOtpCode,
  otpExpiryFrom,
  canResendOtp,
  checkOtp,
  isLocked,
  nextLockState,
} from "@/lib/guest-auth";
import { encryptString } from "@/lib/crypto/encryption";
import {
  signUpEmailSchema,
  logInEmailSchema,
  requestPhoneOtpSchema,
  verifyPhoneOtpSchema,
  updateProfileSchema,
} from "./schema";
import {
  TIMING_EQUALISER_HASH,
  PLACEHOLDER_GUEST_NAME,
  resolvePublicOrgId,
  findOrCreateGuestForAccount,
  deliverOtpSms,
} from "./internal";

/** `needsProfile` is set only on the phone path when a brand-new account was made
 *  with no real name yet — the UI then routes the guest to complete their profile. */
export type GuestAuthResult = { accountId: string; needsProfile?: boolean };
export type OtpRequestResult = { sent: true; devCode?: string };

const INVALID = () => new DomainError(ErrorCode.INVALID_CREDENTIALS);
const LOCKED = () => new DomainError(ErrorCode.ACCOUNT_LOCKED);

/** Email + password sign-up. Creates (or links) a Guest, then the account + session. */
export async function signUpEmail(raw: unknown): Promise<Result<GuestAuthResult>> {
  return toResult(async () => {
    const input = signUpEmailSchema.parse(raw);
    const orgId = await resolvePublicOrgId();
    const emailHash = emailHashOf(input.email);
    const mobileHash = mobileHashOf(input.mobile);
    const passwordHash = await hashPassword(input.password);

    const accountId = await runWithSystemContext(orgId, () =>
      db.unscoped().$transaction(async (tx) => {
        const clash = await tx.guestAccount.findFirst({
          where: { orgId, deletedAt: null, OR: [{ emailHash }, { mobileHash }] },
          select: { id: true },
        });
        if (clash) {
          throw new ConflictError("An account with this email or phone already exists. Please sign in.");
        }

        const guest = await findOrCreateGuestForAccount(tx, {
          orgId,
          fullName: input.fullName,
          mobile: input.mobile,
          email: input.email,
        });

        const account = await tx.guestAccount.create({
          data: {
            orgId,
            guestId: guest.id,
            email: encryptString(input.email.trim().toLowerCase()),
            emailHash,
            mobile: encryptString(normalizeMobile(input.mobile)),
            mobileHash,
            passwordHash,
          },
          select: { id: true },
        });

        await writeAudit(tx, {
          action: "guestaccount:signup",
          entityType: "GuestAccount",
          entityId: account.id,
          after: { method: "email", guestId: guest.id },
        });
        await emitEvent(tx, {
          type: "GuestAccountCreated",
          aggregateId: account.id,
          payload: { guestId: guest.id, method: "email" },
        });
        return account.id;
      }),
    );

    await createGuestSession(accountId);
    return { accountId };
  });
}

/** Email + password login. Timing-equalised; locks after repeated failures. */
export async function logInEmail(raw: unknown): Promise<Result<GuestAuthResult>> {
  return toResult(async () => {
    const input = logInEmailSchema.parse(raw);
    const orgId = await resolvePublicOrgId();
    const emailHash = emailHashOf(input.email);
    const now = new Date();

    const account = await db.unscoped().guestAccount.findFirst({
      where: { orgId, emailHash, deletedAt: null },
      select: { id: true, passwordHash: true, isActive: true, lockedUntil: true, failedLoginCount: true, guestId: true },
    });

    // No account (or a phone-only account with no password): still spend bcrypt
    // time so "no such account" can't be timed apart from a real wrong password.
    if (!account || !account.passwordHash) {
      await verifyPassword(input.password, TIMING_EQUALISER_HASH);
      throw INVALID();
    }
    if (isLocked(account.lockedUntil, now)) throw LOCKED();
    if (!account.isActive) throw INVALID();

    const good = await verifyPassword(input.password, account.passwordHash);
    if (!good) {
      const { failedLoginCount, lockedUntil } = nextLockState(account.failedLoginCount, now);
      await runWithSystemContext(orgId, () =>
        db.unscoped().$transaction(async (tx) => {
          await tx.guestAccount.update({ where: { id: account.id }, data: { failedLoginCount, lockedUntil } });
          await writeAudit(tx, {
            action: "guestaccount:login-failed",
            entityType: "GuestAccount",
            entityId: account.id,
            after: { failedLoginCount, locked: lockedUntil !== null },
          });
        }),
      );
      throw INVALID();
    }

    await runWithSystemContext(orgId, () =>
      db.unscoped().$transaction(async (tx) => {
        await tx.guestAccount.update({ where: { id: account.id }, data: { failedLoginCount: 0, lockedUntil: null } });
        await writeAudit(tx, { action: "guestaccount:login", entityType: "GuestAccount", entityId: account.id });
        await emitEvent(tx, {
          type: "GuestAccountSignedIn",
          aggregateId: account.id,
          payload: { guestId: account.guestId, method: "email" },
        });
      }),
    );

    await createGuestSession(account.id, now);
    return { accountId: account.id };
  });
}

/** Request a phone OTP (unified signup+login). Rate-limited per phone. */
export async function requestPhoneOtp(raw: unknown): Promise<Result<OtpRequestResult>> {
  return toResult(async () => {
    const input = requestPhoneOtpSchema.parse(raw);
    const orgId = await resolvePublicOrgId();
    const mobileHash = mobileHashOf(input.mobile);
    const now = new Date();
    const code = generateOtpCode();

    await runWithSystemContext(orgId, () =>
      db.unscoped().$transaction(async (tx) => {
        const last = await tx.guestOtp.findFirst({
          where: { orgId, mobileHash },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        });
        if (!canResendOtp(last?.createdAt ?? null, now)) {
          throw new DomainError(ErrorCode.RATE_LIMITED, undefined, {
            publicMessage: "Please wait a moment before requesting another code.",
          });
        }
        await tx.guestOtp.create({
          data: {
            orgId,
            mobileHash,
            codeHash: hashOtpCode(code),
            purpose: "PHONE_AUTH",
            expiresAt: otpExpiryFrom(now),
          },
        });
        await writeAudit(tx, {
          action: "guestaccount:otp-request",
          entityType: "GuestOtp",
          entityId: mobileHash, // the code is NEVER audited
        });
      }),
    );

    await deliverOtpSms(input.mobile, code);
    // No live SMS gateway is wired yet (deliverOtpSms uses the mock provider), so
    // the code is never actually delivered. Surface it in the response so the demo
    // phone-OTP flow is usable end-to-end (integrations.md sandbox rule). The moment
    // a real gateway is activated (SMS_MODE=live), stop returning it.
    const smsLive = process.env.SMS_MODE === "live";
    return smsLive ? { sent: true } : { sent: true, devCode: code };
  });
}

/** Verify a phone OTP → find-or-create account + Guest, issue a session. */
export async function verifyPhoneOtp(raw: unknown): Promise<Result<GuestAuthResult>> {
  return toResult(async () => {
    const input = verifyPhoneOtpSchema.parse(raw);
    const orgId = await resolvePublicOrgId();
    const mobileHash = mobileHashOf(input.mobile);
    const now = new Date();

    const { accountId, needsProfile } = await runWithSystemContext(orgId, () =>
      db.unscoped().$transaction(async (tx) => {
        const otp = await tx.guestOtp.findFirst({
          where: { orgId, mobileHash, purpose: "PHONE_AUTH", consumedAt: null },
          orderBy: { createdAt: "desc" },
          select: { id: true, codeHash: true, expiresAt: true, consumedAt: true, attempts: true },
        });
        if (!otp) throw INVALID();

        const verdict = checkOtp(otp, input.code, now);
        if (!verdict.ok) {
          // Count the miss (only a genuine mismatch consumes an attempt).
          if (verdict.reason === "mismatch") {
            await tx.guestOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
          }
          throw new DomainError(ErrorCode.INVALID_CREDENTIALS, undefined, {
            publicMessage:
              verdict.reason === "mismatch"
                ? "That code isn't right. Please try again."
                : "This code has expired or is no longer valid. Please request a new one.",
          });
        }

        await tx.guestOtp.update({ where: { id: otp.id }, data: { consumedAt: now } });

        // Existing account for this phone → login; else find-or-create Guest + account.
        const existing = await tx.guestAccount.findFirst({
          where: { orgId, mobileHash, deletedAt: null },
          select: { id: true, guestId: true, isActive: true },
        });
        if (existing) {
          if (!existing.isActive) throw INVALID();
          await tx.guestAccount.update({
            where: { id: existing.id },
            data: { phoneVerifiedAt: now, failedLoginCount: 0, lockedUntil: null },
          });
          await writeAudit(tx, { action: "guestaccount:login", entityType: "GuestAccount", entityId: existing.id });
          await emitEvent(tx, {
            type: "GuestAccountSignedIn",
            aggregateId: existing.id,
            payload: { guestId: existing.guestId, method: "phone" },
          });
          return { accountId: existing.id, needsProfile: false };
        }

        const guest = await findOrCreateGuestForAccount(tx, {
          orgId,
          fullName: input.fullName?.trim() || PLACEHOLDER_GUEST_NAME,
          mobile: input.mobile,
        });
        const account = await tx.guestAccount.create({
          data: {
            orgId,
            guestId: guest.id,
            mobile: encryptString(normalizeMobile(input.mobile)),
            mobileHash,
            phoneVerifiedAt: now,
          },
          select: { id: true },
        });
        await writeAudit(tx, {
          action: "guestaccount:signup",
          entityType: "GuestAccount",
          entityId: account.id,
          after: { method: "phone", guestId: guest.id },
        });
        await emitEvent(tx, {
          type: "GuestAccountCreated",
          aggregateId: account.id,
          payload: { guestId: guest.id, method: "phone" },
        });
        // No real name captured yet (placeholder) → the UI will ask for one.
        return { accountId: account.id, needsProfile: guest.fullName === PLACEHOLDER_GUEST_NAME };
      }),
    );

    await createGuestSession(accountId, now);
    return { accountId, needsProfile };
  });
}

/** Sign out the current guest (revoke session row + clear cookie). Idempotent. */
export async function logOutGuest(): Promise<Result<{ ok: true }>> {
  return toResult(async () => {
    await revokeGuestSession();
    return { ok: true };
  });
}

/**
 * The signed-in guest edits their own profile — name (so a phone-only signup stops
 * showing the "Guest" placeholder) and, optionally, an email. Identity comes from
 * the session, never the client. Name updates the CRM `Guest`; email is mirrored
 * onto the account (used for login + display) and de-duplicated against other
 * accounts before it is accepted.
 */
export async function updateMyProfile(raw: unknown): Promise<Result<{ ok: true }>> {
  return toResult(async () => {
    const principal = await resolveGuestSession();
    if (!principal) throw new DomainError(ErrorCode.UNAUTHENTICATED);

    const input = updateProfileSchema.parse(raw);
    const normalizedEmail = input.email ? input.email.trim().toLowerCase() : null;
    const emailHash = normalizedEmail ? emailHashOf(normalizedEmail) : null;

    await runWithSystemContext(principal.orgId, () =>
      db.unscoped().$transaction(async (tx) => {
        if (emailHash) {
          const clash = await tx.guestAccount.findFirst({
            where: { orgId: principal.orgId, emailHash, id: { not: principal.accountId }, deletedAt: null },
            select: { id: true },
          });
          if (clash) {
            throw new ConflictError("That email is already used by another account.");
          }
        }

        await tx.guest.update({
          where: { id: principal.guestId },
          data: {
            fullName: input.fullName,
            ...(normalizedEmail ? { email: encryptString(normalizedEmail), emailHash } : {}),
          },
        });

        if (normalizedEmail) {
          await tx.guestAccount.update({
            where: { id: principal.accountId },
            data: { email: encryptString(normalizedEmail), emailHash },
          });
        }

        await writeAudit(tx, {
          action: "guestaccount:profile-update",
          entityType: "GuestAccount",
          entityId: principal.accountId,
        });
        await emitEvent(tx, {
          type: "GuestProfileUpdated",
          aggregateId: principal.accountId,
          payload: { guestId: principal.guestId, emailChanged: Boolean(normalizedEmail) },
        });
      }),
    );

    return { ok: true };
  });
}
