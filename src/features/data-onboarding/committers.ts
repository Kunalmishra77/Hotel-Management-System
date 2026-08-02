/**
 * Per-kind row committers — 26 T-10/T-12/T-13 (FR-5). Each creates its target
 * ONLY through the owning module's authorized public action — never a foreign
 * INSERT — and returns the created id to stamp on the ImportRow (traceability +
 * rollback). Idempotency is defence-in-depth: 04's own dedup, 03's channelRef,
 * and a pre-check here all conspire so a re-run creates nothing new (AC-11).
 */
import { db } from "@/lib/db";
import { createGuest } from "@/features/guests/actions";
import { createFromChannel } from "@/features/reservations/channel-actions";
import { checkIn, checkOut } from "@/features/reservations/lifecycle-actions";
import { ensureDirectSaleFolio } from "@/features/billing/folio-actions";
import { postFolioCharge } from "@/features/billing/charge-actions";
import { ErrorCode } from "@/lib/errors";
import type { NormalizedRow } from "./domain/validate";
import type { MasterData } from "./lookups";
import type { SessionClaims } from "@/lib/auth/claims";

export type CommitOutcome = {
  status: "OK" | "SKIPPED_DUPLICATE" | "ERROR";
  targetType?: string;
  targetId?: string;
  error?: string;
};

/** GUESTS → 04.createGuest (dedup honored → a duplicate becomes an idempotent SKIP). */
export async function commitGuestRow(n: NormalizedRow): Promise<CommitOutcome> {
  const res = await createGuest({
    fullName: n.fullName ?? "",
    mobile: n.mobile ?? "",
    email: n.email ?? undefined,
    city: n.city ?? undefined,
    state: n.state ?? undefined,
    companyName: n.companyName ?? undefined,
    gstNumber: n.gstNumber ?? undefined,
    // Do NOT force-create through a probable duplicate — that IS our idempotency
    // guard: a re-import of the same guest returns CONFLICT and we skip it.
    confirmDuplicate: false,
  });
  if (res.ok) return { status: "OK", targetType: "Guest", targetId: res.data.id };
  if (res.error.code === ErrorCode.CONFLICT) return { status: "SKIPPED_DUPLICATE" };
  return { status: "ERROR", error: res.error.message };
}

/**
 * RESERVATIONS → a historical CHECKED_OUT stay via 03's channel-style ingest
 * (past-date tolerant + idempotent on channelRef, unlike createReservation which
 * refuses past dates), then driven through check-in → check-out so guest history
 * and room-nights populate (05). channelRef = the row's importKey.
 */
export async function commitReservationRow(
  user: SessionClaims,
  propertyId: string,
  channelRef: string,
  n: NormalizedRow,
  guestId: string,
  master: MasterData,
): Promise<CommitOutcome> {
  // Idempotency: a reservation already ingested for this channelRef → skip.
  const existing = await db.scoped(user).reservation.findFirst({
    where: { propertyId, channelRef },
    select: { id: true },
  });
  if (existing) return { status: "SKIPPED_DUPLICATE", targetType: "Reservation", targetId: existing.id };

  const roomId = n.roomNo ? master.roomsByNumber.get(n.roomNo.toLowerCase()) : undefined;
  const categoryId = n.categoryName ? master.categoriesByName.get(n.categoryName.toLowerCase()) : undefined;

  const nights = Math.max(
    1,
    Math.round((n.checkOutDate!.getTime() - n.checkInDate!.getTime()) / 86_400_000),
  );
  // A completed stay carries no outstanding here (opening dues import separately):
  // set advance = room charge so the check-out balance gate is satisfied cleanly.
  const ratePaise = n.amountPaise ? Math.round(n.amountPaise / nights) : 0;
  const advancePaise = ratePaise * nights;

  let created;
  try {
    created = await createFromChannel({
      propertyId,
      guestId,
      source: n.source ?? "DIRECT",
      channelRef,
      checkInDate: n.checkInDate!,
      checkOutDate: n.checkOutDate!,
      adults: n.adults ?? 1,
      children: n.children ?? 0,
      ratePaise,
      advancePaise,
      ...(roomId ? { roomIds: [roomId] } : categoryId ? { categoryId } : {}),
    });
  } catch (e) {
    return { status: "ERROR", error: (e as Error).message };
  }

  // Progress it to CHECKED_OUT (CONFIRMED → IN_HOUSE → CHECKED_OUT).
  const inRes = await checkIn({ reservationId: created.id });
  if (inRes.ok) await checkOut({ reservationId: created.id, defer: false });

  return { status: "OK", targetType: "Reservation", targetId: created.id };
}

/**
 * BALANCES → an opening-balance line on the property house folio via 06
 * (ensureDirectSaleFolio + postFolioCharge). The guest is referenced in the
 * description so the due is attributable. (See report: a GST-exempt opening-line
 * surface in 06 is requested so outstanding equals the imported figure exactly.)
 */
export async function commitBalanceRow(
  propertyId: string,
  n: NormalizedRow,
  guestId: string,
): Promise<CommitOutcome> {
  const folio = await ensureDirectSaleFolio({ propertyId });
  if (!folio.ok) return { status: "ERROR", error: folio.error.message };

  const res = await postFolioCharge({
    folioId: folio.data.folioId,
    type: "MISC",
    description: `Opening balance (import) · guest:${guestId} · ${n.mobile ?? ""}`,
    quantity: 1,
    unitPaise: n.amountPaise!,
  });
  if (!res.ok) return { status: "ERROR", error: res.error.message };
  return { status: "OK", targetType: "FolioLine", targetId: res.data.lineId };
}
