"use server";

/**
 * Per-room ordering QR — 19 addendum (FR-19, T-25). Stamps a stable, unguessable
 * `orderToken` on the room (once, idempotent) and returns a scannable QR + the
 * link for the in-room ordering page. `room:manage` only. The token is not a
 * secret credential — the public page is occupied-gated + rate-limited (FR-20/26)
 * — but it is unguessable so a room can't be enumerated.
 *
 * QR is generated server-side (ADR-0007: `qrcode`), never a client bundle or a
 * remote service.
 */
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { roomDb, withRoomContext } from "./internal";

const schema = z.object({ roomId: z.string().min(1) });

/** Absolute URL a room's QR encodes. NEXT_PUBLIC_APP_URL must be set in prod for
 *  a scannable code; falls back to localhost for dev. */
export function roomOrderUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/order/${token}`;
}

export async function getRoomOrderQr(
  input: unknown,
): Promise<Result<{ url: string; qrDataUrl: string; number: string }>> {
  return toResult(async () => {
    const { roomId } = schema.parse(input);
    const user = await requireUser();
    const scoped = roomDb(user);
    const room = await scoped.room.findFirst({
      where: { id: roomId },
      select: { propertyId: true, number: true, orderToken: true },
    });
    if (!room) throw new NotFoundError("Room not found");
    authorize(user, "room:manage", room.propertyId);

    let token = room.orderToken;
    if (!token) {
      const fresh = randomUUID();
      token = await withRoomContext(user, () =>
        scoped.$transaction(async (tx) => {
          // CAS: only the first stamper wins; a concurrent stamp is read back.
          const res = await tx.room.updateMany({
            where: { id: roomId, orderToken: null },
            data: { orderToken: fresh },
          });
          if (res.count === 0) {
            const r = await tx.room.findFirstOrThrow({ where: { id: roomId }, select: { orderToken: true } });
            return r.orderToken!;
          }
          await writeAudit(tx, {
            action: "room:order-token",
            entityType: "Room",
            entityId: roomId,
            propertyId: room.propertyId,
            after: { stamped: true },
          });
          return fresh;
        }),
      );
    }

    const url = roomOrderUrl(token);
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 240 });
    return { url, qrDataUrl, number: room.number };
  });
}
