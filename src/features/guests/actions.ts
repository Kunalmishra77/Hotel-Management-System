"use server";

/**
 * Guest create/update — 04 T-8 (FR-1/2/5/6/11, AC-1/2/3).
 *
 * createGuest runs duplicate detection under a per-(orgId, contact-token)
 * advisory lock. There is NO unique DB constraint on the contact token (by
 * design — an explicit "create anyway" must be able to make a second record),
 * so the lock is what serialises the create-vs-create race: two receptionists
 * entering the same walk-in at once can't both slip past the dedupe check.
 */
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { encryptOptional, encryptString } from "@/lib/crypto/encryption";
import { normalizePhone } from "./domain/normalize";
import {
  duplicateScore,
  isProbableDuplicate,
  type GuestMatchInput,
} from "./domain/dedupe";
import { maskContact } from "./domain/masking";
import { createGuestSchema, updateGuestSchema } from "./schema";
import {
  contactColumns,
  emailToken,
  guestDb,
  mobileToken,
  withGuestContext,
} from "./internal";

export type GuestCreated = { id: string; fullName: string };

export type DuplicateCandidate = {
  id: string;
  fullName: string;
  maskedMobile: string | null;
  city: string | null;
};

/**
 * Create a guest, gated by duplicate detection (FR-5).
 *
 * Returns a `DUPLICATE_GUEST` failure carrying masked candidates unless the
 * caller passed `confirmDuplicate: true`. The candidates are masked — a dedupe
 * prompt must not become a way to read PII you otherwise can't (AC-7).
 */
export async function createGuest(input: unknown): Promise<Result<GuestCreated>> {
  return toResult(async () => {
    const data = createGuestSchema.parse(input);
    const user = await requireUser();
    authorize(user, "guest:create");

    const prisma = guestDb();
    const mobileHash = mobileToken(data.mobile);
    const emailHash = emailToken(data.email);

    return withGuestContext(user, () =>
      prisma.$transaction(async (tx) => {
        // Serialize on the primary contact token so a concurrent create sees
        // this one before inserting (design.md sequence). Two tokens → two
        // locks, always acquired in a fixed order to avoid deadlock.
        for (const token of [mobileHash, emailHash].filter(Boolean).sort()) {
          await acquireAdvisoryLock(tx, user.orgId, token as string);
        }

        if (!data.confirmDuplicate) {
          const candidates = await findDuplicates(tx, user.orgId, {
            fullName: data.fullName,
            mobile: data.mobile,
            email: data.email ?? null,
            idValues: [],
          });
          if (candidates.length > 0) {
            throw new DomainError(ErrorCode.CONFLICT, "Possible duplicate guest", {
              publicMessage: "A guest with these details may already exist.",
              details: { code: "DUPLICATE_GUEST", candidates },
            });
          }
        }

        const guest = await tx.guest.create({
          data: {
            orgId: user.orgId,
            fullName: data.fullName,
            gender: data.gender ?? null,
            dob: data.dob ? new Date(data.dob) : null,
            nationality: data.nationality ?? null,
            occupation: data.occupation ?? null,
            addressLine: data.addressLine ?? null,
            city: data.city ?? null,
            state: data.state ?? null,
            country: data.country ?? null,
            pincode: data.pincode ?? null,
            companyName: data.companyName ?? null,
            gstNumber: data.gstNumber ?? null,
            purposeOfVisit: data.purposeOfVisit ?? null,
            specialRequests: data.specialRequests ?? null,
            foodPreference: data.foodPreference ?? null,
            medicalNotes: data.medicalNotes ?? null,
            preferredRoomCategoryId: data.preferredRoomCategoryId ?? null,
            preferredFloor: data.preferredFloor ?? null,
            // Contact stored ENCRYPTED; the *Hash columns are the keyed search
            // tokens. mobile is required (validated), so it is never null here.
            mobile: encryptString(data.mobile),
            mobileHash,
            whatsapp: encryptOptional(data.whatsapp ?? null),
            email: encryptOptional(data.email ?? null),
            emailHash,
          },
          select: { id: true, fullName: true },
        });

        await emitEvent(tx, {
          type: "GuestCreated",
          aggregateId: guest.id,
          // No PII in the payload — 05/12/14 re-read through their own queries.
          payload: { guestId: guest.id },
        });
        await writeAudit(tx, {
          action: "guest:create",
          entityType: "Guest",
          entityId: guest.id,
          // fullName is not masked in audit (front-desk identifier); contact is
          // never written to the audit row.
          after: { fullName: guest.fullName },
        });

        revalidatePath("/guests");
        return guest;
      }),
    );
  });
}

/** Edit a guest (FR-2); re-runs dedupe and recomputes tokens on contact change. */
export async function updateGuest(input: unknown): Promise<Result<GuestCreated>> {
  return toResult(async () => {
    const { id, confirmDuplicate: _c, ...patch } = updateGuestSchema.parse(input);
    const user = await requireUser();
    authorize(user, "guest:manage");

    const prisma = guestDb();

    return withGuestContext(user, () =>
      prisma.$transaction(async (tx) => {
        const existing = await tx.guest.findFirst({
          where: { id, orgId: user.orgId, deletedAt: null },
          select: { id: true, fullName: true },
        });
        if (!existing) throw new NotFoundError("Guest not found");

        const updated = await tx.guest.update({
          where: { id },
          data: {
            ...stripUndefined({
              fullName: patch.fullName,
              gender: patch.gender,
              // @db.Date — undefined skips, null clears, string sets.
              dob: patch.dob !== undefined ? (patch.dob ? new Date(patch.dob) : null) : undefined,
              nationality: patch.nationality,
              occupation: patch.occupation,
              addressLine: patch.addressLine,
              city: patch.city,
              state: patch.state,
              country: patch.country,
              pincode: patch.pincode,
              companyName: patch.companyName,
              gstNumber: patch.gstNumber,
              purposeOfVisit: patch.purposeOfVisit,
              specialRequests: patch.specialRequests,
              foodPreference: patch.foodPreference,
              medicalNotes: patch.medicalNotes,
              preferredRoomCategoryId: patch.preferredRoomCategoryId,
              preferredFloor: patch.preferredFloor,
            }),
            // Recompute the encrypted value + search token together on change.
            ...contactColumns({
              ...(patch.mobile !== undefined ? { mobile: patch.mobile } : {}),
              ...(patch.whatsapp !== undefined ? { whatsapp: patch.whatsapp } : {}),
              ...(patch.email !== undefined ? { email: patch.email } : {}),
            }),
          },
          select: { id: true, fullName: true },
        });

        await emitEvent(tx, { type: "GuestUpdated", aggregateId: id, payload: { guestId: id } });
        await writeAudit(tx, {
          action: "guest:update",
          entityType: "Guest",
          entityId: id,
          after: { changed: Object.keys(patch) },
        });

        revalidatePath("/guests");
        revalidatePath(`/guests/${id}`);
        return updated;
      }),
    );
  });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

/**
 * A transaction-scoped advisory lock keyed on (orgId, token). Postgres takes a
 * pair of int4 keys; we derive them with `hashtext` so any string token maps
 * to a lock. Released automatically at commit/rollback (`_xact_`), so a crash
 * never leaves a guest-creation lock stuck.
 */
async function acquireAdvisoryLock(tx: Tx, orgId: string, token: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`guest:${orgId}`}), hashtext(${token}))`;
}

/** Probable duplicates in the org, returned MASKED (AC-7). */
async function findDuplicates(
  tx: Tx,
  orgId: string,
  candidate: GuestMatchInput,
): Promise<DuplicateCandidate[]> {
  const mobileHash = mobileToken(candidate.mobile);
  const emailHash = emailToken(candidate.email);

  const tokenMatches =
    mobileHash || emailHash
      ? await tx.guest.findMany({
          where: {
            orgId,
            deletedAt: null,
            OR: [
              ...(mobileHash ? [{ mobileHash }] : []),
              ...(emailHash ? [{ emailHash }] : []),
            ],
          },
          select: { id: true, fullName: true, city: true, mobile: true },
          take: 10,
        })
      : [];

  return tokenMatches
    .map((row) => {
      const score = duplicateScore(candidate, {
        fullName: row.fullName,
        // The stored mobile is encrypted; the token already matched, so treat
        // it as the candidate's own number for scoring purposes.
        mobile: candidate.mobile,
        email: candidate.email,
        idValues: [],
      });
      return { row, score };
    })
    .filter(({ score }) => isProbableDuplicate(score))
    .map(({ row }) => ({
      id: row.id,
      fullName: row.fullName,
      // Mask from the candidate's own input — never decrypt the stored value.
      maskedMobile: maskContact(normalizePhone(candidate.mobile), "mobile"),
      city: row.city,
    }));
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k as keyof T] = v as T[keyof T];
  }
  return out;
}
