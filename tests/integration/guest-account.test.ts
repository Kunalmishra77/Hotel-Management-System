/**
 * Phase 2 (customer redesign) — guest-account actions + My Bookings scoping.
 *
 * Verifies the guest auth surface against Postgres: email signup creates + links
 * one CRM Guest, duplicate → CONFLICT, login timing/lockout, phone-OTP
 * request/verify/rate-limit, and that My Bookings is scoped to the session's
 * guestId (a guest never sees another guest's bookings — IDOR).
 *
 * next/headers is mocked with an in-memory cookie jar so the cookie-setting
 * actions run in node. Rows use per-run-unique contacts so the unique
 * (orgId, mobileHash/emailHash) constraints never collide with leftovers.
 */
import { vi, afterAll, beforeEach, describe, expect, it } from "vitest";

// In-memory cookie jar behind next/headers (module-level so the mock closes over it).
const jar = new Map<string, string>();
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => void jar.set(n, v),
    delete: (n: string) => void jar.delete(n),
  }),
  headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "127.0.0.1" }),
}));

import { createPrismaClient } from "@/lib/db/client";
import { ORG_ID, PROP_A_ID } from "../../prisma/seed/fixtures";
import { mobileHashOf, emailHashOf, resolveGuestSession, type GuestPrincipal } from "@/lib/guest-auth";
import {
  signUpEmail,
  logInEmail,
  requestPhoneOtp,
  verifyPhoneOtp,
} from "@/features/guest-account/actions";
import { listMyBookings, getMyBooking } from "@/features/guest-account/queries";
import { submitOnlineCheckIn } from "@/features/guest-account/checkin-actions";

const prisma = createPrismaClient();
const NONCE = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

// Valid Indian mobiles (start 6-9, 10 digits), unique per run.
let mobileSeq = 0;
function freshMobile(): string {
  mobileSeq += 1;
  return `9${String(9_000_000_00 + mobileSeq + (Date.now() % 1000)).slice(0, 9)}`;
}
function freshEmail(tag: string): string {
  return `guest_${tag}_${NONCE}@example.test`;
}

const createdAccountIds: string[] = [];
const createdGuestIds: string[] = [];
const createdReservationIds: string[] = [];
const createdOtpMobileHashes: string[] = [];

async function trackNewRows(email?: string, mobile?: string): Promise<void> {
  const where = email
    ? { orgId: ORG_ID, emailHash: emailHashOf(email) }
    : { orgId: ORG_ID, mobileHash: mobileHashOf(mobile!) };
  const acc = await prisma.guestAccount.findFirst({ where, select: { id: true, guestId: true } });
  if (acc) {
    if (!createdAccountIds.includes(acc.id)) createdAccountIds.push(acc.id);
    if (!createdGuestIds.includes(acc.guestId)) createdGuestIds.push(acc.guestId);
  }
}

beforeEach(() => jar.clear());

afterAll(async () => {
  await prisma.registrationCard.deleteMany({ where: { reservationId: { in: createdReservationIds } } });
  await prisma.reservation.deleteMany({ where: { id: { in: createdReservationIds } } });
  await prisma.guestSession.deleteMany({ where: { guestAccountId: { in: createdAccountIds } } });
  await prisma.guestOtp.deleteMany({
    where: { OR: [{ guestAccountId: { in: createdAccountIds } }, { orgId: ORG_ID, mobileHash: { in: createdOtpMobileHashes } }] },
  });
  await prisma.guestAccount.deleteMany({ where: { id: { in: createdAccountIds } } });
  await prisma.guest.deleteMany({ where: { id: { in: createdGuestIds } } });
  await prisma.$disconnect();
});

describe("signUpEmail", () => {
  it("creates a linked account + a session, and rejects a duplicate", async () => {
    const email = freshEmail("dup");
    const mobile = freshMobile();

    const res = await signUpEmail({ fullName: "Test Guest", email, password: "hunter2xy", mobile });
    expect(res.ok).toBe(true);
    await trackNewRows(email);

    // A guest session cookie was issued and resolves to the new account.
    const principal = await resolveGuestSession();
    expect(principal).not.toBeNull();
    expect(principal!.orgId).toBe(ORG_ID);

    // The account links to a real CRM Guest.
    const acc = await prisma.guestAccount.findFirst({
      where: { orgId: ORG_ID, emailHash: emailHashOf(email) },
      select: { guestId: true, passwordHash: true },
    });
    expect(acc?.passwordHash).toBeTruthy();
    const guest = await prisma.guest.findUnique({ where: { id: acc!.guestId }, select: { id: true } });
    expect(guest).not.toBeNull();

    // Second signup with the same email → CONFLICT.
    const dup = await signUpEmail({ fullName: "Again", email, password: "hunter2xy", mobile: freshMobile() });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("CONFLICT");
  });
});

describe("logInEmail", () => {
  it("rejects a wrong password, accepts the right one, and locks after repeated failures", async () => {
    const email = freshEmail("login");
    const password = "correct-horse-1";
    const signup = await signUpEmail({ fullName: "Login Guest", email, password, mobile: freshMobile() });
    expect(signup.ok).toBe(true);
    await trackNewRows(email);

    const wrong = await logInEmail({ email, password: "nope-nope-1" });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe("INVALID_CREDENTIALS");

    const right = await logInEmail({ email, password });
    expect(right.ok).toBe(true);

    // Drive the counter to the lock threshold (5 wrong), then even the right
    // password is refused with ACCOUNT_LOCKED.
    for (let i = 0; i < 5; i++) await logInEmail({ email, password: "still-wrong-1" });
    const locked = await logInEmail({ email, password });
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.error.code).toBe("ACCOUNT_LOCKED");
  });

  it("returns INVALID_CREDENTIALS (not a distinct error) for an unknown email", async () => {
    const res = await logInEmail({ email: freshEmail("ghost"), password: "whatever-1" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("INVALID_CREDENTIALS");
  });
});

describe("phone OTP", () => {
  it("issues a dev code, rejects a wrong code, verifies the right one, and rate-limits resend", async () => {
    const mobile = freshMobile();
    createdOtpMobileHashes.push(mobileHashOf(mobile));

    const req = await requestPhoneOtp({ mobile, fullName: "Phone Guest" });
    expect(req.ok).toBe(true);
    const devCode = req.ok ? req.data.devCode : undefined;
    expect(devCode).toMatch(/^\d{6}$/);

    // Immediate resend for the same number is blocked by the cooldown.
    const again = await requestPhoneOtp({ mobile });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("RATE_LIMITED");

    // A wrong code fails.
    const bad = await verifyPhoneOtp({ mobile, code: devCode === "000000" ? "111111" : "000000" });
    expect(bad.ok).toBe(false);

    // The right code creates (or links) the account + a session.
    const good = await verifyPhoneOtp({ mobile, code: devCode!, fullName: "Phone Guest" });
    expect(good.ok).toBe(true);
    await trackNewRows(undefined, mobile);

    const principal = await resolveGuestSession();
    expect(principal).not.toBeNull();
  });
});

describe("My Bookings scoping (IDOR)", () => {
  it("returns only the session guest's own bookings", async () => {
    // Two distinct guests.
    const aGuest = await prisma.guest.create({
      data: { orgId: ORG_ID, fullName: "Owner A", mobile: "enc", mobileHash: `mh_a_${NONCE}` },
      select: { id: true },
    });
    const bGuest = await prisma.guest.create({
      data: { orgId: ORG_ID, fullName: "Owner B", mobile: "enc", mobileHash: `mh_b_${NONCE}` },
      select: { id: true },
    });
    createdGuestIds.push(aGuest.id, bGuest.id);

    const mk = async (guestId: string, code: string) => {
      const r = await prisma.reservation.create({
        data: {
          propertyId: PROP_A_ID, code, guestId, status: "CONFIRMED", source: "WEBSITE",
          checkInDate: new Date("2027-01-10"), checkOutDate: new Date("2027-01-12"),
          nights: 2, adults: 2, ratePaise: 500000, taxPaise: 60000, advancePaise: 0,
        },
        select: { id: true },
      });
      createdReservationIds.push(r.id);
      return r.id;
    };
    const aRes = await mk(aGuest.id, `GA-${NONCE}`);
    await mk(bGuest.id, `GB-${NONCE}`);

    const principalA: GuestPrincipal = { sessionId: "s", accountId: "acc", guestId: aGuest.id, orgId: ORG_ID };
    const principalB: GuestPrincipal = { sessionId: "s", accountId: "acc", guestId: bGuest.id, orgId: ORG_ID };

    const aList = await listMyBookings(principalA);
    expect(aList.map((x) => x.reservationId)).toContain(aRes);
    expect(aList.every((x) => x.reservationId !== undefined)).toBe(true);

    // B's reservation must not leak into A's list.
    const bIds = (await listMyBookings(principalB)).map((x) => x.reservationId);
    expect(bIds).not.toContain(aRes);

    // getMyBooking refuses another guest's booking id (IDOR → null).
    expect(await getMyBooking(principalB, aRes)).toBeNull();
    expect(await getMyBooking(principalA, aRes)).not.toBeNull();
  });
});

describe("submitOnlineCheckIn (Wave 2)", () => {
  const sig = Buffer.from("wave2-online-checkin-signature").toString("base64");

  async function makeReservation(guestId: string, code: string, status: string): Promise<string> {
    const r = await prisma.reservation.create({
      data: {
        propertyId: PROP_A_ID, code, guestId, status: status as never, source: "WEBSITE",
        checkInDate: new Date("2027-03-10"), checkOutDate: new Date("2027-03-12"),
        nights: 2, adults: 2, ratePaise: 500000, taxPaise: 60000, advancePaise: 0,
      },
      select: { id: true },
    });
    createdReservationIds.push(r.id);
    return r.id;
  }

  it("signs the registration card, flags the reservation, and blocks non-owners + non-confirmed stays", async () => {
    // A signed-in guest (signup sets the session cookie in the jar).
    const email = freshEmail("oci");
    const signup = await signUpEmail({ fullName: "OCI Guest", email, password: "check-in-99", mobile: freshMobile() });
    expect(signup.ok).toBe(true);
    await trackNewRows(email);
    const acc = await prisma.guestAccount.findFirst({
      where: { orgId: ORG_ID, emailHash: emailHashOf(email) },
      select: { guestId: true },
    });
    const guestId = acc!.guestId;

    const confirmed = await makeReservation(guestId, `OCI-${NONCE}`, "CONFIRMED");

    // Happy path: the guest's own CONFIRMED booking checks in online.
    const ok = await submitOnlineCheckIn({
      reservationId: confirmed,
      signatureBase64: sig,
      expectedArrival: "around 7 PM",
      specialRequests: "High floor please",
    });
    expect(ok.ok).toBe(true);

    // A RegistrationCard exists, guest-completed (no capturedById), source online.
    const card = await prisma.registrationCard.findFirst({
      where: { reservationId: confirmed },
      select: { capturedById: true, signatureObjectKey: true, signatureChecksum: true, guestSnapshot: true },
    });
    expect(card).not.toBeNull();
    expect(card!.capturedById).toBeNull();
    expect(card!.signatureObjectKey).toBeTruthy();
    expect(card!.signatureChecksum).toBeTruthy();
    expect((card!.guestSnapshot as { source?: string }).source).toBe("online");

    // The reservation is flagged + ETA persisted for reception.
    const res = await prisma.reservation.findUnique({
      where: { id: confirmed },
      select: { onlineCheckInAt: true, expectedArrival: true },
    });
    expect(res!.onlineCheckInAt).not.toBeNull();
    expect(res!.expectedArrival).toBe("around 7 PM");

    // A second confirmed booking, but the session now belongs to another guest → NOT_FOUND (IDOR).
    const otherEmail = freshEmail("oci-other");
    const other = await signUpEmail({ fullName: "Other", email: otherEmail, password: "check-in-99", mobile: freshMobile() });
    expect(other.ok).toBe(true);
    await trackNewRows(otherEmail);
    const foreign = await submitOnlineCheckIn({ reservationId: confirmed, signatureBase64: sig });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error.code).toBe("NOT_FOUND");

    // A CHECKED_OUT booking (owned by that second guest) can't be re-checked-in online.
    const otherAcc = await prisma.guestAccount.findFirst({
      where: { orgId: ORG_ID, emailHash: emailHashOf(otherEmail) },
      select: { guestId: true },
    });
    const checkedOut = await makeReservation(otherAcc!.guestId, `OCO-${NONCE}`, "CHECKED_OUT");
    const late = await submitOnlineCheckIn({ reservationId: checkedOut, signatureBase64: sig });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error.code).toBe("ILLEGAL_TRANSITION");
  });
});
