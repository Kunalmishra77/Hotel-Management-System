"use server";

/**
 * Correct the channel of an extension's nights after the fact (client, 17 Nov
 * 2026 — Anand Agarwal: first night on MakeMyTrip, the extra night agreed
 * direct, but the extension was saved under the wrong channel). The nights'
 * channel drives revenue-by-source and which bill they go on (OTA bill vs the
 * guest's direct bill), both derived from StayExtension, so nothing else moves.
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { reservationDb, withReservationContext } from "./internal";

const SOURCES = [
  "DIRECT", "WEBSITE", "PHONE", "WALK_IN",
  "AIRBNB", "BOOKING_COM", "AGODA", "MAKEMYTRIP", "GOIBIBO", "EXPEDIA",
  "CORPORATE", "TRAVEL_AGENT",
] as const;

const changeExtensionSourceSchema = z.object({
  reservationId: z.string().min(1),
  /** The extension's first added night, YYYY-MM-DD — identifies it on the booking. */
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.enum(SOURCES),
});

export async function changeExtensionSource(input: unknown): Promise<Result<{ updated: number }>> {
  return toResult(async () => {
    const data = changeExtensionSourceSchema.parse(input);
    const user = await requireUser();
    const client = reservationDb(user);
    const r = await client.reservation.findFirst({ where: { id: data.reservationId }, select: { id: true, propertyId: true } });
    if (!r) throw new NotFoundError("Reservation not found.");
    authorize(user, "reservation:modify", r.propertyId);
    const fromDate = new Date(`${data.fromDate}T00:00:00.000Z`);

    return withReservationContext(user, () =>
      client.$transaction(async (tx) => {
        const ext = await tx.stayExtension.findMany({ where: { reservationId: r.id, fromDate }, select: { id: true, source: true } });
        if (ext.length === 0) throw new NotFoundError("Extension not found.");
        await tx.stayExtension.updateMany({ where: { id: { in: ext.map((e) => e.id) } }, data: { source: data.source } });
        await emitEvent(tx, { type: "ReservationModified", aggregateId: r.id, propertyId: r.propertyId, payload: { extensionFrom: data.fromDate, extensionSource: data.source } });
        await writeAudit(tx, {
          action: "reservation:extension-source", entityType: "Reservation", entityId: r.id, propertyId: r.propertyId,
          before: { fromDate: data.fromDate, source: ext[0]!.source }, after: { fromDate: data.fromDate, source: data.source },
        });
        revalidatePath(`/bookings/${r.id}`);
        return { updated: ext.length };
      }),
    );
  });
}
