/**
 * Transaction-composable folio posting (workstream 3C, T1).
 *
 * The existing charge/payment ACTIONS are standalone `"use server"` entrypoints
 * with their own auth + transaction, so they can't be composed inside another
 * module's transaction (e.g. 03's check-in / check-out). These helpers do the
 * same folio writes but take the caller's `tx`, so the folio becomes the single
 * money truth across booking → check-in → night-audit → check-out.
 *
 * NOT a "use server" module. Callers run inside `runWithContext` (for the audit
 * actor) and own the transaction. IDEMPOTENCY for room charges — one ROOM line
 * per `(folioId, businessDate)` — is the CALLER's responsibility: pre-check the
 * dates already posted so a unique violation can't poison the enclosing tx.
 */
import { randomUUID } from "node:crypto";
import type { PaymentMode, Prisma } from "@prisma/client";
import { emitEvent, type EventCapableTx } from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import { roomGstBps, gstBpsForCharge, hsnSacForCharge } from "@/lib/constants/gst";
import { computeGst } from "./domain/gst";

type AuditTx = Parameters<typeof writeAudit>[0];

/** The tx capabilities these helpers need — structural, like `EventCapableTx`. */
export type BillingPostTx = EventCapableTx &
  AuditTx & {
    folioLine: {
      create(args: {
        data: Prisma.FolioLineUncheckedCreateInput;
        select: { id: true };
      }): Promise<{ id: string }>;
    };
    payment: {
      create(args: {
        data: Prisma.PaymentUncheckedCreateInput;
        select: { id: true };
      }): Promise<{ id: string }>;
    };
  };

export type RoomChargeInput = {
  folioId: string;
  propertyId: string;
  /** On-premise supply: place-of-supply = the property's state (IGST Act §12). */
  propertyState: string;
  ratePaise: number;
  businessDate: Date;
  postedById?: string | null;
  description?: string;
};

/**
 * PURE: the FolioLine row for one room-night, with GST computed from the room
 * tariff band and split intra-state (CGST+SGST) because accommodation is always
 * an on-premise supply (business-rules.md §10). Unit-tested without a DB.
 */
export function roomChargeLineData(input: RoomChargeInput): Prisma.FolioLineUncheckedCreateInput {
  const bps = roomGstBps(input.ratePaise);
  const gst = computeGst(input.ratePaise, bps, input.propertyState, input.propertyState);
  return {
    folioId: input.folioId,
    type: "ROOM",
    description: input.description ?? "Room charge",
    quantity: 1,
    unitPaise: input.ratePaise,
    amountPaise: BigInt(input.ratePaise),
    taxRateBps: bps,
    cgstPaise: gst.cgstPaise,
    sgstPaise: gst.sgstPaise,
    igstPaise: gst.igstPaise,
    hsnSac: "996311",
    placeOfSupplyState: input.propertyState,
    businessDate: input.businessDate,
    postedById: input.postedById ?? null,
  };
}

/** Post one room-night ROOM charge. Caller ensures the date isn't already posted. */
export async function postRoomChargeTx(tx: BillingPostTx, input: RoomChargeInput): Promise<string> {
  const line = await tx.folioLine.create({ data: roomChargeLineData(input), select: { id: true } });
  await emitEvent(tx, {
    type: "FolioCharged",
    aggregateId: input.folioId,
    propertyId: input.propertyId,
    payload: {
      lineId: line.id,
      type: "ROOM",
      amountPaise: input.ratePaise,
      businessDate: input.businessDate.toISOString().slice(0, 10),
    },
  });
  await writeAudit(tx, {
    action: "folio:room-night",
    entityType: "FolioLine",
    entityId: line.id,
    propertyId: input.propertyId,
    after: { amountPaise: input.ratePaise },
  });
  return line.id;
}

export type BookingExtrasInput = {
  folioId: string;
  propertyId: string;
  /** On-premise supply: place-of-supply = the property's state (IGST Act §12). */
  propertyState: string;
  extraBedPaise: number;
  otherChargesPaise: number;
  discountPaise: number;
  businessDate: Date;
  postedById?: string | null;
};

/**
 * PURE: the NON-room folio lines of an agreed booking bill — extra bed, other
 * charges, and discount — so the folio (not the reservation snapshot) is the full
 * bill (workstream 3C, Option A). Each service line carries GST from its SAC band,
 * split intra-state (on-premise). The discount is a negative, tax-free adjustment
 * line (`FolioLine.amountPaise` is signed): it reduces the balance by exactly the
 * agreed amount. Per-line taxable-value reduction of the discount is a 06
 * refinement; the derived balance is correct either way. Zero components emit no
 * line. Unit-tested without a DB.
 */
export function bookingExtraLineData(input: BookingExtrasInput): Prisma.FolioLineUncheckedCreateInput[] {
  const lines: Prisma.FolioLineUncheckedCreateInput[] = [];
  const base = {
    folioId: input.folioId,
    businessDate: input.businessDate,
    postedById: input.postedById ?? null,
    placeOfSupplyState: input.propertyState,
  };

  if (input.extraBedPaise > 0) {
    const bps = gstBpsForCharge("EXTRA_BED");
    const gst = computeGst(input.extraBedPaise, bps, input.propertyState, input.propertyState);
    lines.push({
      ...base, type: "EXTRA_BED", description: "Extra bed", quantity: 1,
      unitPaise: input.extraBedPaise, amountPaise: BigInt(input.extraBedPaise),
      taxRateBps: bps, cgstPaise: gst.cgstPaise, sgstPaise: gst.sgstPaise, igstPaise: gst.igstPaise,
      hsnSac: hsnSacForCharge("EXTRA_BED"),
    });
  }

  if (input.otherChargesPaise > 0) {
    const bps = gstBpsForCharge("MISC");
    const gst = computeGst(input.otherChargesPaise, bps, input.propertyState, input.propertyState);
    lines.push({
      ...base, type: "MISC", description: "Other charges", quantity: 1,
      unitPaise: input.otherChargesPaise, amountPaise: BigInt(input.otherChargesPaise),
      taxRateBps: bps, cgstPaise: gst.cgstPaise, sgstPaise: gst.sgstPaise, igstPaise: gst.igstPaise,
      hsnSac: hsnSacForCharge("MISC"),
    });
  }

  if (input.discountPaise > 0) {
    lines.push({
      ...base, type: "DISCOUNT", description: "Discount", quantity: 1,
      unitPaise: -input.discountPaise, amountPaise: BigInt(-input.discountPaise),
      taxRateBps: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, hsnSac: null,
    });
  }

  return lines;
}

/**
 * Post the agreed booking's non-room lines (extra bed / other / discount) onto
 * the folio. Idempotency is the CALLER's job — post once per folio at check-in
 * (guard on the existence of these line types), never per-night.
 */
export async function postBookingExtrasTx(tx: BillingPostTx, input: BookingExtrasInput): Promise<string[]> {
  const rows = bookingExtraLineData(input);
  const ids: string[] = [];
  for (const data of rows) {
    const line = await tx.folioLine.create({ data, select: { id: true } });
    ids.push(line.id);
    await emitEvent(tx, {
      type: "FolioCharged",
      aggregateId: input.folioId,
      propertyId: input.propertyId,
      payload: {
        lineId: line.id,
        type: data.type,
        amountPaise: Number(data.amountPaise),
        businessDate: input.businessDate.toISOString().slice(0, 10),
      },
    });
    await writeAudit(tx, {
      action: "folio:booking-charge",
      entityType: "FolioLine",
      entityId: line.id,
      propertyId: input.propertyId,
      after: { type: data.type, amountPaise: Number(data.amountPaise) },
    });
  }
  return ids;
}

export type PaymentInput = {
  folioId: string;
  propertyId: string;
  mode: PaymentMode;
  amountPaise: number;
  reference?: string | null;
  settlementBatchId?: string | null;
  receivedById?: string | null;
};

/** Post one payment tender to a folio (positive amount; `isRefund` refunds only). */
export async function postPaymentTx(tx: BillingPostTx, input: PaymentInput): Promise<string> {
  const settlementBatchId = input.settlementBatchId ?? randomUUID();
  const payment = await tx.payment.create({
    data: {
      propertyId: input.propertyId,
      folioId: input.folioId,
      mode: input.mode,
      amountPaise: BigInt(input.amountPaise),
      reference: input.reference ?? null,
      settlementBatchId,
      isRefund: false,
      receivedById: input.receivedById ?? null,
    },
    select: { id: true },
  });
  await emitEvent(tx, {
    type: "PaymentReceived",
    aggregateId: input.folioId,
    propertyId: input.propertyId,
    payload: {
      folioId: input.folioId,
      settlementBatchId,
      tenders: [{ mode: input.mode, amountPaise: input.amountPaise }],
    },
  });
  await writeAudit(tx, {
    action: "payment:record",
    entityType: "Payment",
    entityId: payment.id,
    propertyId: input.propertyId,
    after: { mode: input.mode, amountPaise: input.amountPaise },
  });
  return payment.id;
}
