"use server";

/**
 * Guest merge — 04 T-11 (FR-12, AC-11).
 *
 * Two confirmed duplicates become one. Under `guest:merge` (🔒, audited): the
 * shared `mergeGuestPairTx` combines fields, re-points EVERY reference to the
 * survivor, soft-deletes the loser with `mergedIntoId` lineage, and emits
 * `GuestMerged` (05 recomputes BOTH). Atomic — a half-merged guest would lose
 * stay history.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { toResult, type Result } from "@/lib/result";
import { findMergeCandidatesSchema, mergeGuestsSchema } from "./schema";
import { guestDb, withGuestContext } from "./internal";
import { mergeGuestPairTx } from "./merge-core";
import { searchGuests } from "./queries";

export type MergeResult = { survivorId: string; loserId: string; repointed: number };

export type MergeCandidate = {
  id: string;
  fullName: string;
  maskedMobile: string | null;
  city: string | null;
  companyName: string | null;
};

/**
 * Masked guest search for the "merge a duplicate into this guest" picker. Gated
 * by `guest:merge` (same permission as the merge itself — only someone who can
 * merge needs to look for candidates). Reuses the permission-scoped, masked
 * `searchGuests`, then drops the current guest so you can't pick yourself.
 * Name-only duplicates (no shared mobile/email) are findable here — the
 * create-time auto-detector only catches shared contact tokens.
 */
export async function findMergeCandidates(input: unknown): Promise<Result<MergeCandidate[]>> {
  return toResult(async () => {
    const data = findMergeCandidatesSchema.parse(input);
    const user = await requireUser();
    authorize(user, "guest:merge", null);
    if (data.query.trim() === "") return [];

    const { guests } = await searchGuests(user, { query: data.query, limit: 10, cursor: null });
    return guests
      .filter((g) => g.id !== data.excludeId)
      .map((g) => ({ id: g.id, fullName: g.fullName, maskedMobile: g.maskedMobile, city: g.city, companyName: g.companyName }));
  });
}

export async function mergeGuests(input: unknown): Promise<Result<MergeResult>> {
  return toResult(async () => {
    const data = mergeGuestsSchema.parse(input);
    const user = await requireUser();
    authorize(user, "guest:merge", null, { reason: data.reason ?? "Confirmed duplicate merge" });

    const result = await withGuestContext(user, () =>
      guestDb().$transaction((tx) =>
        mergeGuestPairTx(tx, { orgId: user.orgId, survivorId: data.survivorId, loserId: data.loserId, reason: data.reason ?? null }),
      ),
    );
    revalidatePath("/guests");
    return result;
  });
}
