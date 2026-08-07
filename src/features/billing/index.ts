/**
 * Billing — public surface (minimal, pre-06).
 *
 * 06-billing owns the folio ledger, GST invoices and night audit. It is a Tier 2
 * module and is not built yet, but 03-reservations (Tier 1) must, on confirm /
 * check-in, ensure a `Folio` exists for the reservation (business-rules.md §5:
 * "every in-house reservation has exactly one folio"). Rather than have 03 write
 * the `Folio` table directly — which would breach the module boundary
 * (architecture.md: cross-module writes go through the target's public surface) —
 * this thin surface exposes exactly what 03 needs today. 06 will expand this file
 * with charge/payment/invoice logic; callers won't change.
 *
 * See docs/architecture/adr/0006-minimal-billing-surface-before-06.md.
 */
import type { Prisma } from "@prisma/client";

/** Structural tx type — same reason as `EventCapableTx`: the scoped extended
 *  client's transaction is nominally different from `Prisma.TransactionClient`. */
export type FolioCapableTx = {
  folio: {
    findUnique(args: {
      where: { reservationId: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    create(args: {
      data: Prisma.FolioUncheckedCreateInput;
      select: { id: true };
    }): Promise<{ id: string }>;
  };
};

/**
 * Ensure exactly one folio exists for a reservation, returning its id.
 *
 * Idempotent: called on both confirm (FR-23) and check-in (FR-9); the second
 * call finds the existing folio rather than creating a duplicate. The
 * `Folio.reservationId` unique constraint is the ultimate guard.
 */
export async function ensureFolio(
  tx: FolioCapableTx,
  input: { reservationId: string; propertyId: string },
): Promise<string> {
  const existing = await tx.folio.findUnique({
    where: { reservationId: input.reservationId },
    select: { id: true },
  });
  if (existing) return existing.id;

  const folio = await tx.folio.create({
    data: {
      propertyId: input.propertyId,
      reservationId: input.reservationId,
      kind: "RESERVATION",
    },
    select: { id: true },
  });
  return folio.id;
}

/**
 * The live folio balance for a reservation (charges + tax − payments), or null
 * if it has no folio. A READ-ONLY surface for reception (booking detail, dues).
 * The check-out GATE still uses the booking snapshot until the folio becomes the
 * authoritative money source — a dedicated billing workstream (post advance +
 * room charges onto the folio consistently, reconciled with the MoM payment
 * states). Displaying the balance is safe; gating on it is not, yet.
 */
export { getBalance } from "./queries";

/** Pure balance derivation (Σ line+tax − payments). Public so 03's check-out can
 *  derive the LIVE balance from folio rows it has read INSIDE its own locked
 *  transaction — the gate must be atomic with the status flip (no TOCTOU). */
export { folioBalance } from "./domain/balance";

/**
 * Transaction-composable folio posting (3C, T1). 03's check-in/out compose these
 * into their own transaction so the folio becomes the single money truth.
 */
export {
  postRoomChargeTx,
  postPaymentTx,
  postBookingExtrasTx,
  roomChargeLineData,
  bookingExtraLineData,
  type BillingPostTx,
} from "./tx-post";
