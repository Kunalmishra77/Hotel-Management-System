/**
 * Traceability: 00 T-4/T-5/T-6 — FR-3/4/5/6, AC-2/3/4/5/6.
 * Every test uses a throwaway user; seeded fixtures stay read-only.
 */
import { createPrismaClient } from "@/lib/db/client";
import { authenticator } from "otplib";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PROP_A_ID } from "../../prisma/seed/fixtures";
import { cleanupTempUsers, createTempUser } from "../helpers/temp-user";
import { verifyCredentials } from "@/lib/auth/credentials";
import {
  beginTotpEnrolment,
  confirmTotpEnrolment,
  disableTotp,
  issueTotpChallenge,
  verifySecondFactor,
  verifyTotpChallenge,
  TOTP_CHALLENGE_TTL_MS,
} from "@/lib/auth/two-factor";
import {
  clearFailedAttempts,
  lockoutMinutesFor,
  recordFailedAttempt,
} from "@/lib/auth/lockout";
import {
  issuePasswordResetToken,
  redeemPasswordResetToken,
} from "@/lib/auth/password-reset";
import { createSession, resolveSession } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { decryptString, isEncrypted } from "@/lib/crypto/encryption";
import { hashBackupCode } from "@/lib/auth/totp";

// Same client configuration as production (transaction budget, logging),
// so tests exercise the real behaviour rather than Prisma defaults.
const prisma = createPrismaClient();
const NOW = new Date("2026-07-21T10:00:00.000Z");

function codeFor(secret: string, at: Date = NOW): string {
  authenticator.options = { epoch: at.getTime(), step: 30 };
  const token = authenticator.generate(secret);
  authenticator.resetOptions();
  return token;
}

afterEach(async () => {
  await cleanupTempUsers(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("TOTP enrolment (FR-5 / AC-5)", () => {
  it("stages an encrypted secret but does NOT activate 2FA until confirmed", async () => {
    const temp = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    const offer = await beginTotpEnrolment(prisma, temp.id);

    expect(offer).not.toBeNull();
    expect(offer!.otpAuthUrl).toContain("otpauth://totp/");

    const row = await prisma.user.findUniqueOrThrow({ where: { id: temp.id } });
    // Staged, encrypted, and still inactive — a mis-scanned QR must not lock
    // the user out of their own account.
    expect(row.totpEnabled).toBe(false);
    expect(isEncrypted(row.totpSecret)).toBe(true);
    expect(decryptString(row.totpSecret!)).toBe(offer!.secret);
  });

  it("activates 2FA and returns backup codes on a valid confirming code", async () => {
    const temp = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    const offer = await beginTotpEnrolment(prisma, temp.id);

    const result = await confirmTotpEnrolment(prisma, temp.id, codeFor(offer!.secret), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.backupCodes).toHaveLength(10);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: temp.id } });
    expect(row.totpEnabled).toBe(true);
    // Shown once, stored hashed.
    for (const code of result.backupCodes) {
      expect(row.backupCodes).not.toContain(code);
      expect(row.backupCodes).toContain(hashBackupCode(code));
    }
  });

  it("refuses to activate on a wrong confirming code", async () => {
    const temp = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    await beginTotpEnrolment(prisma, temp.id);

    const result = await confirmTotpEnrolment(prisma, temp.id, "000000", NOW);
    expect(result).toEqual({ ok: false, reason: "INVALID_CODE" });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: temp.id } });
    expect(row.totpEnabled).toBe(false);
  });

  it("refuses to confirm when no enrolment was started", async () => {
    const temp = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    const result = await confirmTotpEnrolment(prisma, temp.id, "123456", NOW);
    expect(result).toEqual({ ok: false, reason: "NO_PENDING_SECRET" });
  });

  it("disabling clears the secret and codes", async () => {
    const temp = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    const offer = await beginTotpEnrolment(prisma, temp.id);
    await confirmTotpEnrolment(prisma, temp.id, codeFor(offer!.secret), NOW);

    await disableTotp(prisma, temp.id);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: temp.id } });
    expect(row.totpEnabled).toBe(false);
    expect(row.totpSecret).toBeNull();
    expect(row.backupCodes).toEqual([]);
  });
});

describe("second factor at sign-in (AC-2 / AC-3)", () => {
  async function enrolledUser() {
    const temp = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    const offer = await beginTotpEnrolment(prisma, temp.id);
    const confirm = await confirmTotpEnrolment(prisma, temp.id, codeFor(offer!.secret), NOW);
    if (!confirm.ok) throw new Error("fixture enrolment failed");
    return { ...temp, secret: offer!.secret, backupCodes: confirm.backupCodes };
  }

  it("accepts a valid current TOTP (AC-2)", async () => {
    const u = await enrolledUser();
    const r = await verifySecondFactor(prisma, u.id, codeFor(u.secret), NOW);
    expect(r).toEqual({ kind: "OK", usedBackupCode: false });
  });

  it("rejects an invalid TOTP — no session is issued (AC-2)", async () => {
    const u = await enrolledUser();
    expect(await verifySecondFactor(prisma, u.id, "000000", NOW)).toEqual({ kind: "INVALID" });
  });

  it("accepts a backup code and consumes it exactly once (AC-3)", async () => {
    const u = await enrolledUser();
    const code = u.backupCodes[0]!;

    const first = await verifySecondFactor(prisma, u.id, code, NOW);
    expect(first).toEqual({ kind: "OK", usedBackupCode: true });

    const reuse = await verifySecondFactor(prisma, u.id, code, NOW);
    expect(reuse).toEqual({ kind: "INVALID" });

    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.backupCodes).toHaveLength(9);
  });

  it("consumes a backup code only once under concurrent use (design.md race)", async () => {
    const u = await enrolledUser();
    const code = u.backupCodes[0]!;

    const results = await Promise.all([
      verifySecondFactor(prisma, u.id, code, NOW),
      verifySecondFactor(prisma, u.id, code, NOW),
      verifySecondFactor(prisma, u.id, code, NOW),
    ]);

    // Exactly one winner — the conditional UPDATE decides it, not read-then-write.
    expect(results.filter((r) => r.kind === "OK")).toHaveLength(1);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.backupCodes).toHaveLength(9);
  });

  it("reports NOT_ENROLLED for a user without 2FA", async () => {
    const temp = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    expect(await verifySecondFactor(prisma, temp.id, "123456", NOW)).toEqual({
      kind: "NOT_ENROLLED",
    });
  });

  it("marks the enrolled user as requiring TOTP at credential time (FR-3)", async () => {
    const u = await enrolledUser();
    const r = await verifyCredentials(prisma, u.email, u.password, { now: NOW });
    expect(r.kind).toBe("OK");
    if (r.kind === "OK") expect(r.requiresTotp).toBe(true);
  });
});

describe("2FA challenge token", () => {
  it("round-trips the userId it attests to", () => {
    const challenge = issueTotpChallenge("user_abc", NOW);
    expect(verifyTotpChallenge(challenge, NOW)).toBe("user_abc");
  });

  it("expires", () => {
    const challenge = issueTotpChallenge("user_abc", NOW);
    const later = new Date(NOW.getTime() + TOTP_CHALLENGE_TTL_MS + 1000);
    expect(verifyTotpChallenge(challenge, later)).toBeNull();
  });

  it("rejects tampering with the user id", () => {
    const challenge = issueTotpChallenge("user_abc", NOW);
    const forged = challenge.replace("user_abc", "user_xyz");
    expect(verifyTotpChallenge(forged, NOW)).toBeNull();
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "a.b", "a.b.c.d", "garbage"]) {
      expect(verifyTotpChallenge(bad, NOW)).toBeNull();
    }
  });
});

describe("lockout (FR-4 / AC-4)", () => {
  it("locks on the 5th consecutive failure and not before", async () => {
    const temp = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    const orgId = (await prisma.user.findUniqueOrThrow({ where: { id: temp.id } })).orgId;

    for (let i = 1; i <= 4; i++) {
      const r = await recordFailedAttempt(prisma, temp.id, orgId, NOW);
      expect(r.locked, `attempt ${i} must not lock`).toBe(false);
    }

    const fifth = await recordFailedAttempt(prisma, temp.id, orgId, NOW);
    expect(fifth.locked).toBe(true);
    expect(fifth.failedLoginCount).toBe(5);

    // …and the account genuinely refuses the CORRECT password while locked.
    const attempt = await verifyCredentials(prisma, temp.email, temp.password, { now: NOW });
    expect(attempt.kind).toBe("LOCKED");
  });

  it("backs off exponentially on further failures", async () => {
    const temp = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    const orgId = (await prisma.user.findUniqueOrThrow({ where: { id: temp.id } })).orgId;

    let last: Date | null = null;
    for (let i = 1; i <= 7; i++) {
      const r = await recordFailedAttempt(prisma, temp.id, orgId, NOW);
      if (r.locked) {
        const minutes = (r.lockedUntil!.getTime() - NOW.getTime()) / 60_000;
        expect(minutes).toBe(lockoutMinutesFor(r.failedLoginCount, 5));
        if (last) expect(r.lockedUntil!.getTime()).toBeGreaterThan(last.getTime());
        last = r.lockedUntil;
      }
    }
    expect(last).not.toBeNull();
  });

  it("a successful sign-in clears the counter", async () => {
    const temp = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    const orgId = (await prisma.user.findUniqueOrThrow({ where: { id: temp.id } })).orgId;

    await recordFailedAttempt(prisma, temp.id, orgId, NOW);
    await recordFailedAttempt(prisma, temp.id, orgId, NOW);
    await clearFailedAttempts(prisma, temp.id);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: temp.id } });
    expect(row.failedLoginCount).toBe(0);
    expect(row.lockedUntil).toBeNull();
  });

  it("counts concurrent failures without losing any (no read-modify-write)", async () => {
    const temp = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    const orgId = (await prisma.user.findUniqueOrThrow({ where: { id: temp.id } })).orgId;

    await Promise.all(
      Array.from({ length: 5 }, () => recordFailedAttempt(prisma, temp.id, orgId, NOW)),
    );

    const row = await prisma.user.findUniqueOrThrow({ where: { id: temp.id } });
    // A read-then-write implementation would land below 5 here.
    expect(row.failedLoginCount).toBe(5);
  });
});

describe("password reset (FR-6 / AC-6)", () => {
  it("resets the password and invalidates existing sessions", async () => {
    const temp = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    const live = await createSession(prisma, temp.id, {}, NOW);
    expect(await resolveSession(prisma, live!.token, NOW)).not.toBeNull();

    const issued = await issuePasswordResetToken(prisma, temp.email, NOW);
    expect(issued).not.toBeNull();

    const outcome = await redeemPasswordResetToken(
      prisma,
      issued!.token,
      "brand-new-password-2026",
      NOW,
    );
    expect(outcome.kind).toBe("OK");

    const row = await prisma.user.findUniqueOrThrow({ where: { id: temp.id } });
    await expect(verifyPassword("brand-new-password-2026", row.passwordHash)).resolves.toBe(true);
    await expect(verifyPassword(temp.password, row.passwordHash)).resolves.toBe(false);

    // AC-6: existing sessions are invalidated.
    expect(await resolveSession(prisma, live!.token, NOW)).toBeNull();
  });

  it("stores only a hash of the token", async () => {
    const temp = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    const issued = await issuePasswordResetToken(prisma, temp.email, NOW);

    const row = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: temp.id } });
    expect(row.tokenHash).not.toBe(issued!.token);
    expect(row.tokenHash).not.toContain(issued!.token);
  });

  it("rejects a reused token (single-use)", async () => {
    const temp = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    const issued = await issuePasswordResetToken(prisma, temp.email, NOW);

    const first = await redeemPasswordResetToken(prisma, issued!.token, "first-password-2026", NOW);
    expect(first.kind).toBe("OK");

    const second = await redeemPasswordResetToken(
      prisma,
      issued!.token,
      "second-password-2026",
      NOW,
    );
    expect(second.kind).toBe("TOKEN_INVALID");
  });

  it("rejects an expired token", async () => {
    const temp = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    const issued = await issuePasswordResetToken(prisma, temp.email, NOW);
    const tooLate = new Date(issued!.expiresAt.getTime() + 1000);

    const outcome = await redeemPasswordResetToken(prisma, issued!.token, "whatever-2026", tooLate);
    expect(outcome.kind).toBe("TOKEN_INVALID");
  });

  it("rejects a forged token", async () => {
    const outcome = await redeemPasswordResetToken(prisma, "not-a-real-token", "whatever-2026", NOW);
    expect(outcome.kind).toBe("TOKEN_INVALID");
  });

  it("retires an earlier token when a new one is requested", async () => {
    const temp = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    const first = await issuePasswordResetToken(prisma, temp.email, NOW);
    const second = await issuePasswordResetToken(prisma, temp.email, NOW);

    expect(await redeemPasswordResetToken(prisma, first!.token, "pw-from-old-2026", NOW)).toEqual({
      kind: "TOKEN_INVALID",
    });
    expect((await redeemPasswordResetToken(prisma, second!.token, "pw-from-new-2026", NOW)).kind).toBe(
      "OK",
    );
  });

  it("enforces the org password policy on the new password", async () => {
    const temp = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    const issued = await issuePasswordResetToken(prisma, temp.email, NOW);

    const outcome = await redeemPasswordResetToken(prisma, issued!.token, "short", NOW);
    expect(outcome.kind).toBe("WEAK_PASSWORD");

    // …and the token survives a rejected attempt, so the user can retry.
    const retry = await redeemPasswordResetToken(prisma, issued!.token, "long-enough-2026", NOW);
    expect(retry.kind).toBe("OK");
  });

  it("returns null for an unknown email — caller must still respond identically (FR-4)", async () => {
    expect(await issuePasswordResetToken(prisma, "nobody@woodpecker.example", NOW)).toBeNull();
  });

  it("clears a lockout — the inbox owner proved control", async () => {
    const temp = await createTempUser(prisma, { role: "RECEPTION", propertyIds: [PROP_A_ID] });
    const orgId = (await prisma.user.findUniqueOrThrow({ where: { id: temp.id } })).orgId;
    for (let i = 0; i < 5; i++) await recordFailedAttempt(prisma, temp.id, orgId, NOW);

    const issued = await issuePasswordResetToken(prisma, temp.email, NOW);
    await redeemPasswordResetToken(prisma, issued!.token, "recovered-password-2026", NOW);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: temp.id } });
    expect(row.failedLoginCount).toBe(0);
    expect(row.lockedUntil).toBeNull();
  });
});
