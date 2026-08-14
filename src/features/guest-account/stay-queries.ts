import "server-only";
/**
 * In-room portal reads (Phase 4). The active stay + the guest's own requests are
 * resolved from the SESSION guest (never a client id): a guest can only ever see
 * their own current stay and their own requests.
 */
import { db } from "@/lib/db";
import { folioBalance } from "@/features/billing/domain/balance";
import type { GuestPrincipal } from "@/lib/guest-auth";

export type FolioLineView = { description: string; amountPaise: number };

export type ActiveStay = {
  reservationId: string;
  code: string;
  propertyName: string;
  roomNumber: string | null;
  roomId: string | null;
  orderToken: string | null;
  checkOutDate: Date;
  folio: { balancePaise: number; lines: FolioLineView[] } | null;
};

/** The guest's current IN_HOUSE stay (room + folio), or null if not checked in. */
export async function getActiveStay(principal: GuestPrincipal): Promise<ActiveStay | null> {
  const r = await db.unscoped().reservation.findFirst({
    where: { guestId: principal.guestId, status: "IN_HOUSE" },
    orderBy: { checkInDate: "desc" },
    select: {
      id: true,
      code: true,
      checkOutDate: true,
      property: { select: { name: true } },
      allocations: {
        take: 1,
        select: { room: { select: { id: true, number: true, orderToken: true } } },
      },
      folio: {
        select: {
          id: true,
          lines: { select: { description: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } },
          payments: { select: { amountPaise: true, isRefund: true } },
        },
      },
    },
  });
  if (!r) return null;

  const room = r.allocations[0]?.room ?? null;
  const folio = r.folio
    ? {
        balancePaise: Number(folioBalance(r.folio.lines, r.folio.payments)),
        lines: r.folio.lines.map((l) => ({ description: l.description, amountPaise: Number(l.amountPaise) })),
      }
    : null;

  return {
    reservationId: r.id,
    code: r.code,
    propertyName: r.property.name,
    roomNumber: room?.number ?? null,
    roomId: room?.id ?? null,
    orderToken: room?.orderToken ?? null,
    checkOutDate: r.checkOutDate,
    folio,
  };
}

export type MyRequest = {
  id: string;
  kind: string;
  detail: string;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
};

/** The guest's own service requests, newest first. */
export async function listMyRequests(principal: GuestPrincipal): Promise<MyRequest[]> {
  return db.unscoped().guestRequest.findMany({
    where: { guestId: principal.guestId },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, kind: true, detail: true, status: true, createdAt: true, resolvedAt: true },
  });
}
