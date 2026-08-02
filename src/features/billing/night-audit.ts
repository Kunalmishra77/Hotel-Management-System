/**
 * Night-audit room-night posting — 06 T-19 (FR-5, AC-18). NOT a "use server"
 * module: called by 14's night audit under a system context, sweeping every
 * in-house folio.
 *
 * IDEMPOTENT by construction: the partial-unique index
 * `FolioLine(folioId, businessDate) WHERE type='ROOM'` makes a re-run's second
 * ROOM line for the same folio+date conflict — caught and skipped. So a night
 * audit that runs twice posts each room-night exactly once.
 */
import { db } from "@/lib/db";
import { runWithSystemContext } from "@/lib/context";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { roomGstBps } from "@/lib/constants/gst";
import { computeGst } from "./domain/gst";
import { folioBalance } from "./domain/balance";
import { isUniqueViolation } from "./internal";

export async function postRoomCharges(
  propertyId: string,
  businessDate: Date,
): Promise<{ posted: number; skipped: number }> {
  const prisma = db.unscoped();
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { orgId: true, state: true },
  });
  if (!property) return { posted: 0, skipped: 0 };

  const inHouse = await prisma.reservation.findMany({
    where: { propertyId, status: "IN_HOUSE" },
    select: { id: true, ratePaise: true, folio: { select: { id: true } } },
  });

  let posted = 0;
  let skipped = 0;
  await runWithSystemContext(property.orgId, async () => {
    for (const res of inHouse) {
      if (!res.folio) continue; // folio is ensured at check-in; skip if somehow absent
      const rateBps = roomGstBps(res.ratePaise);
      const gst = computeGst(res.ratePaise, rateBps, property.state, property.state); // on-premise → intra
      try {
        // Each in its own tx so one skipped duplicate doesn't abort the others
        // (a constraint violation poisons the whole Postgres transaction).
        await prisma.$transaction(async (tx) => {
          const line = await tx.folioLine.create({
            data: {
              folioId: res.folio!.id,
              type: "ROOM",
              description: "Room charge (night audit)",
              quantity: 1,
              unitPaise: res.ratePaise,
              amountPaise: BigInt(res.ratePaise),
              taxRateBps: rateBps,
              cgstPaise: gst.cgstPaise,
              sgstPaise: gst.sgstPaise,
              igstPaise: gst.igstPaise,
              hsnSac: "996311",
              placeOfSupplyState: property.state,
              businessDate,
            },
            select: { id: true },
          });
          await emitEvent(tx, { type: "FolioCharged", aggregateId: res.folio!.id, propertyId, payload: { lineId: line.id, type: "ROOM", amountPaise: res.ratePaise, businessDate: businessDate.toISOString().slice(0, 10) } });
          await writeAudit(tx, { action: "folio:room-night", entityType: "FolioLine", entityId: line.id, propertyId, after: { amountPaise: res.ratePaise } });
        });
        posted += 1;
      } catch (e) {
        if (isUniqueViolation(e)) {
          skipped += 1; // already posted for this folio+date — idempotent re-run
        } else {
          throw e;
        }
      }

      // FR-20 / AC-20: a folio still owing at close raises a reminder event.
      const f = await prisma.folio.findUnique({
        where: { id: res.folio.id },
        select: {
          lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } },
          payments: { select: { amountPaise: true, isRefund: true } },
        },
      });
      if (f && folioBalance(f.lines, f.payments) > 0n) {
        await prisma.$transaction(async (tx) => {
          await emitEvent(tx, { type: "PaymentDueDetected", aggregateId: res.folio!.id, propertyId, payload: { folioId: res.folio!.id, businessDate: businessDate.toISOString().slice(0, 10) } });
        });
      }
    }
  });

  return { posted, skipped };
}
