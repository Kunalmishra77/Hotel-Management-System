/**
 * PMS Agent · doing things (client, 12 Nov 2026). A parsed command
 * (domain/agent-commands.ts) is turned into a PROPOSAL — the exact booking, what
 * will change, and a Confirm button. Nothing runs until the user confirms; then
 * `runAgentCommand` (actions.ts) calls the SAME server action the screen would
 * (extendStay, checkOut, recordPayment…), so permissions, business rules, events
 * and the audit trail apply exactly as if the button had been pressed.
 *
 * Also the "anything wrong?" scan: stays still in-house after their check-out
 * date, arrivals about to be no-showed, bookings with no room, OTA bills whose
 * prepayment was never recorded, unpaid checked-out bills — each with a fix to
 * confirm where a safe one exists.
 * NOT "use server" — called by the agent and by tests with explicit claims.
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import { formatINR } from "@/lib/utils";
import { billParts, folioBalance, OTA_SOURCES } from "@/features/billing";
import type { SessionClaims } from "@/lib/auth/claims";
import type { ParsedCommand, Target } from "./domain/agent-commands";

const CHANNEL = z.enum(["DIRECT", "WALK_IN", "PHONE", "WEBSITE", "CORPORATE", "TRAVEL_AGENT", "BOOKING_COM", "MAKEMYTRIP", "EXPEDIA", "AGODA", "GOIBIBO", "AIRBNB"]);

/** What the Confirm button runs — validated again on the server before dispatch. */
export const agentCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("extend"), reservationId: z.string(), newCheckOutDate: z.string(), ratePaise: z.number().int().positive().optional(), gstMode: z.enum(["inclusive", "exclusive"]), source: CHANNEL.optional() }),
  z.object({ action: z.literal("checkIn"), reservationId: z.string() }),
  z.object({ action: z.literal("checkOut"), reservationId: z.string() }),
  z.object({ action: z.literal("rate"), reservationId: z.string(), newRatePaise: z.number().int().positive(), gstMode: z.enum(["inclusive", "exclusive"]) }),
  z.object({ action: z.literal("payment"), folioId: z.string(), amountPaise: z.number().int().positive(), mode: z.enum(["CASH", "UPI", "CREDIT_CARD", "DEBIT_CARD", "BANK_TRANSFER", "ONLINE"]), reference: z.string().max(100).optional() }),
  z.object({ action: z.literal("holdLate"), reservationId: z.string() }),
  z.object({ action: z.literal("releaseHold"), reservationId: z.string() }),
  z.object({ action: z.literal("source"), reservationId: z.string(), source: CHANNEL }),
  z.object({ action: z.literal("move"), reservationId: z.string(), toRoomId: z.string(), fromRoomId: z.string().optional() }),
  z.object({ action: z.literal("roomStatus"), roomId: z.string(), to: z.literal("VACANT") }),
  z.object({ action: z.literal("charge"), folioId: z.string(), type: z.enum(["FOOD", "LAUNDRY", "TAXI", "AIRPORT_TRANSFER", "EXTRA_BED", "MISC"]), description: z.string().max(200), unitPaise: z.number().int().positive() }),
]);
export type AgentCommand = z.infer<typeof agentCommandSchema>;
export type AgentProposal = { summary: string; confirmLabel: string; command: AgentCommand };
export type ProposalAnswer = { answer: string; proposal?: AgentProposal; items?: { title: string; subtitle: string; href?: string; proposal?: AgentProposal }[]; matched: boolean };

const short = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const long = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const LABEL: Record<string, string> = { MAKEMYTRIP: "MakeMyTrip", BOOKING_COM: "Booking.com", AGODA: "Agoda", GOIBIBO: "Goibibo", AIRBNB: "Airbnb", EXPEDIA: "Expedia", DIRECT: "Direct", WALK_IN: "Walk-in", PHONE: "Phone", WEBSITE: "Website", CORPORATE: "Corporate", TRAVEL_AGENT: "Travel agent" };
const MODE: Record<string, string> = { CASH: "cash", UPI: "UPI", CREDIT_CARD: "credit card", DEBIT_CARD: "debit card", BANK_TRANSFER: "bank transfer", ONLINE: "Online / OTA prepaid" };

function todayUtc(): Date {
  const s = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return new Date(`${s}T00:00:00Z`);
}

const SEL = {
  id: true, code: true, status: true, source: true, checkInDate: true, checkOutDate: true, nights: true, ratePaise: true, arrivalGuaranteed: true, propertyId: true,
  guest: { select: { fullName: true } },
  allocations: { select: { roomId: true, startDate: true, endDate: true, room: { select: { number: true } } } },
  folio: { select: { id: true, lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } }, payments: { select: { amountPaise: true, isRefund: true } } } },
} as const;
type Bk = {
  id: string; code: string; status: string; source: string; checkInDate: Date; checkOutDate: Date; nights: number; ratePaise: number; arrivalGuaranteed: boolean; propertyId: string;
  guest: { fullName: string }; allocations: { roomId: string; startDate: Date; endDate: Date; room: { number: string } }[];
  folio: { id: string; lines: { amountPaise: bigint; cgstPaise: number; sgstPaise: number; igstPaise: number }[]; payments: { amountPaise: bigint; isRefund: boolean }[] } | null;
};
const who = (b: Bk) => `${b.guest.fullName} (${b.code}${b.allocations.length ? `, ${[...new Set(b.allocations.map((a) => a.room.number))].join(", ")}` : ""})`;

/** Find the one booking a command is about, or explain why not. */
async function resolve(user: SessionClaims, ids: string[], target: Target, prefer: string[]): Promise<Bk | string> {
  const scoped = db.scoped(user).reservation;
  if (target.code) {
    const b = await scoped.findFirst({ where: { code: target.code, propertyId: { in: ids } }, select: SEL });
    return (b as Bk | null) ?? `No booking ${target.code} in your properties.`;
  }
  if (target.room) {
    const today = todayUtc();
    const rows = (await scoped.findMany({
      where: { propertyId: { in: ids }, status: { in: prefer as never }, allocations: { some: { room: { number: { equals: target.room, mode: "insensitive" } }, startDate: { lte: today }, endDate: { gt: today } } } },
      select: SEL, take: 5,
    })) as Bk[];
    if (rows.length === 1) return rows[0]!;
    if (rows.length === 0) return `Nobody ${prefer.includes("IN_HOUSE") ? "staying" : "booked"} in room ${target.room} right now. Use the booking code (BK-…).`;
    return `Room ${target.room} matches more than one booking (${rows.map((r) => r.code).join(", ")}) — use the booking code.`;
  }
  if (target.name) {
    const words = target.name.split(" ").filter((w) => w.length >= 3);
    const rows = (await scoped.findMany({
      where: { propertyId: { in: ids }, status: { in: prefer as never }, AND: words.map((w) => ({ guest: { fullName: { contains: w, mode: "insensitive" } } })) },
      select: SEL, take: 5, orderBy: { checkInDate: "desc" },
    })) as Bk[];
    if (rows.length === 1) return rows[0]!;
    if (rows.length === 0) return `No ${prefer.map((s) => s.toLowerCase().replace("_", "-")).join(" / ")} booking for "${target.name}". Use the booking code (BK-…).`;
    return `"${target.name}" matches ${rows.length} bookings (${rows.map((r) => `${r.guest.fullName} ${r.code}`).join(", ")}) — use the booking code.`;
  }
  return "Which booking? Add the booking code (BK-…), the room (e.g. 2F-3) or the guest's name.";
}

/** Turn a parsed command into a confirmable proposal (nothing changes here). */
export async function proposeCommand(user: SessionClaims, cmd: ParsedCommand): Promise<ProposalAnswer> {
  const ids = user.activePropertyId ? [user.activePropertyId] : [...user.accessiblePropertyIds];
  if (cmd.kind === "scan") return scanIssues(user, ids);
  const ask = (msg: string): ProposalAnswer => ({ answer: msg, matched: false });

  if (cmd.kind === "roomClean") {
    const room = await db.scoped(user).room.findFirst({ where: { propertyId: { in: ids }, number: { equals: cmd.room, mode: "insensitive" } }, select: { id: true, number: true, status: true } });
    if (!room) return ask(`No room ${cmd.room} in your properties.`);
    if (room.status !== "HOUSEKEEPING") return ask(`Room ${room.number} is ${room.status.toLowerCase().replace(/_/g, " ")}, not waiting for cleaning.`);
    return { answer: `Room ${room.number} is waiting for cleaning.`, proposal: { summary: `Mark room ${room.number} clean → Vacant (ready to sell).`, confirmLabel: "Mark clean", command: { action: "roomStatus", roomId: room.id, to: "VACANT" } }, matched: true };
  }

  const prefer: Record<string, string[]> = {
    checkIn: ["CONFIRMED"], checkOut: ["IN_HOUSE"], extend: ["IN_HOUSE", "CONFIRMED"], rate: ["IN_HOUSE", "CONFIRMED", "CHECKED_OUT"],
    payment: ["IN_HOUSE", "CHECKED_OUT", "CONFIRMED"], holdLate: ["CONFIRMED", "NO_SHOW"], releaseHold: ["CONFIRMED"], source: ["IN_HOUSE", "CONFIRMED", "CHECKED_OUT"],
    move: ["IN_HOUSE", "CONFIRMED"], charge: ["IN_HOUSE", "CHECKED_OUT"],
  };
  const b = await resolve(user, ids, cmd.target, prefer[cmd.kind] ?? ["IN_HOUSE", "CONFIRMED"]);
  if (typeof b === "string") return ask(b);
  const bal = b.folio ? Number(folioBalance(b.folio.lines, b.folio.payments)) : 0;
  const ok = (answer: string, summary: string, confirmLabel: string, command: AgentCommand): ProposalAnswer => ({ answer, proposal: { summary, confirmLabel, command }, matched: true });
  const stay = `${short(b.checkInDate)} → ${short(b.checkOutDate)}`;

  switch (cmd.kind) {
    case "extend": {
      const cur = b.checkOutDate.toISOString().slice(0, 10);
      if (cmd.date <= cur) return ask(`${who(b)} already checks out on ${long(cur)} — give a later date.`);
      const nights = Math.round((Date.parse(cmd.date) - Date.parse(cur)) / 86_400_000);
      const rate = cmd.ratePaise ? `${formatINR(cmd.ratePaise)}/night ${cmd.gstInclusive ? "incl. GST" : "+ GST"}` : "the rate the guest pays now";
      return ok(`${who(b)} · ${stay}`, `Extend to ${long(cmd.date)} (+${nights} night${nights === 1 ? "" : "s"}) at ${rate}, booked via ${LABEL[cmd.source ?? "DIRECT"]}. The extra nights are billed now; payment stays due.`, "Extend stay",
        { action: "extend", reservationId: b.id, newCheckOutDate: cmd.date, ...(cmd.ratePaise ? { ratePaise: cmd.ratePaise } : {}), gstMode: cmd.gstInclusive ? "inclusive" : "exclusive", source: cmd.source ?? "DIRECT" });
    }
    case "checkIn":
      if (b.status !== "CONFIRMED") return ask(`${who(b)} is ${b.status.toLowerCase().replace("_", "-")} — only a confirmed booking can be checked in.`);
      if (b.allocations.length === 0) return ask(`${who(b)} has no room. Assign one first (e.g. "${b.code} ko 2F-3 me shift karo").`);
      return ok(`${who(b)} · ${stay}`, `Check in now. The whole stay is billed from ${short(b.checkInDate)}. Their details and a photo ID must already be on file — otherwise use the check-in screen.`, "Check in", { action: "checkIn", reservationId: b.id });
    case "checkOut": {
      const today = todayUtc();
      const note = b.checkOutDate > today ? " Leaving early — unused nights are reversed." : b.checkOutDate < today ? ` They were due out ${short(b.checkOutDate)}: nights up to today are billed.` : "";
      return ok(`${who(b)} · ${stay} · balance ${formatINR(bal)}`, `Check out now.${note}${bal > 0 ? ` A balance of ${formatINR(bal)} is due — take the payment first or check-out will be refused.` : ""} The GST invoice(s) are issued.`, "Check out", { action: "checkOut", reservationId: b.id });
    }
    case "rate":
      return ok(`${who(b)} · ${stay} · now ${formatINR(b.ratePaise)}/night`, `Change the room rate to ${formatINR(cmd.ratePaise)}/night ${cmd.gstInclusive ? "incl. GST" : "+ GST"} for the whole stay — billed nights are re-priced (reversal + re-post) and the booking's rate updates.`, "Change rate",
        { action: "rate", reservationId: b.id, newRatePaise: cmd.ratePaise, gstMode: cmd.gstInclusive ? "inclusive" : "exclusive" });
    case "payment":
      if (!b.folio) return ask(`${who(b)} has no bill yet.`);
      return ok(`${who(b)} · balance ${formatINR(bal)}`, `Record ${formatINR(cmd.amountPaise)} received by ${MODE[cmd.mode]}.${cmd.amountPaise > bal && bal >= 0 ? ` That is ${formatINR(cmd.amountPaise - bal)} more than the balance — the guest will be in credit.` : ""}`, "Record payment",
        { action: "payment", folioId: b.folio.id, amountPaise: cmd.amountPaise, mode: cmd.mode, reference: "Recorded by the PMS Agent" });
    case "holdLate":
      return ok(`${who(b)} · ${stay} · ${b.status.toLowerCase().replace("_", "-")}`, `Hold for a late arrival: never marked no-show, the room stays theirs${b.status === "NO_SHOW" ? " (given back if still free)" : ""}, billed from ${short(b.checkInDate)} at check-in.`, "Hold booking", { action: "holdLate", reservationId: b.id });
    case "releaseHold":
      if (!b.arrivalGuaranteed) return ask(`${who(b)} isn't on a late-arrival hold.`);
      return ok(`${who(b)} · ${stay}`, "Remove the late-arrival hold — the normal no-show rule applies again tonight.", "Remove hold", { action: "releaseHold", reservationId: b.id });
    case "source":
      return ok(`${who(b)} · now ${LABEL[b.source] ?? b.source}`, `Change the booking source to ${LABEL[cmd.source]}.`, "Change source", { action: "source", reservationId: b.id, source: cmd.source });
    case "move": {
      const room = await db.scoped(user).room.findFirst({ where: { propertyId: b.propertyId, number: { equals: cmd.toRoom, mode: "insensitive" } }, select: { id: true, number: true } });
      if (!room) return ask(`No room ${cmd.toRoom} in ${who(b)}'s property.`);
      const from = cmd.target.room ? b.allocations.find((a) => a.room.number.toUpperCase() === cmd.target.room) : undefined;
      return ok(`${who(b)} · ${stay}`, `${b.allocations.length ? `Move from ${from?.room.number ?? b.allocations.at(-1)!.room.number}` : "Assign"} to room ${room.number}${b.status === "IN_HOUSE" ? " from today" : ""}. Refused if ${room.number} isn't free for those nights.`, b.allocations.length ? "Move room" : "Assign room",
        { action: "move", reservationId: b.id, toRoomId: room.id, ...(from ? { fromRoomId: from.roomId } : {}) });
    }
    case "charge":
      if (!b.folio) return ask(`${who(b)} has no bill yet.`);
      return ok(`${who(b)}`, `Add ${cmd.description} ${formatINR(cmd.amountPaise)} + GST to the bill.`, "Add charge", { action: "charge", folioId: b.folio.id, type: cmd.chargeType, description: cmd.description, unitPaise: cmd.amountPaise });
  }
}

/** "Koi galti hai?" — what needs attention, with a confirmable fix where one is safe. */
export async function scanIssues(user: SessionClaims, ids: string[]): Promise<ProposalAnswer> {
  const today = todayUtc();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const scoped = db.scoped(user).reservation;
  const canMoney = hasPermission(user, "folio:view");
  const items: NonNullable<ProposalAnswer["items"]> = [];

  const [overstays, unassigned, missed, otaStays, unpaid] = await Promise.all([
    scoped.findMany({ where: { propertyId: { in: ids }, status: "IN_HOUSE", checkOutDate: { lt: today } }, select: SEL, take: 20 }) as Promise<Bk[]>,
    scoped.findMany({ where: { propertyId: { in: ids }, status: "CONFIRMED", checkInDate: { lte: new Date(today.getTime() + 86_400_000) }, allocations: { none: {} } }, select: SEL, take: 20 }) as Promise<Bk[]>,
    scoped.findMany({ where: { propertyId: { in: ids }, status: "CONFIRMED", arrivalGuaranteed: false, checkInDate: { lte: yesterday } }, select: SEL, take: 20 }) as Promise<Bk[]>,
    canMoney ? db.scoped(user).reservation.findMany({
      where: { propertyId: { in: ids }, status: "CHECKED_OUT", source: { in: [...OTA_SOURCES] as never }, checkOutDate: { gte: new Date(today.getTime() - 45 * 86_400_000) }, folio: { payments: { none: { mode: "ONLINE" } } } },
      select: { id: true, code: true, source: true, guest: { select: { fullName: true } }, extensions: { select: { fromDate: true, toDate: true, source: true } },
        folio: { select: { id: true, lines: { select: { id: true, type: true, description: true, businessDate: true, reversalOfId: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } }, payments: { select: { mode: true, reference: true, amountPaise: true, isRefund: true } } } } },
      take: 60,
    }) : Promise.resolve([]),
    canMoney ? scoped.findMany({ where: { propertyId: { in: ids }, status: "CHECKED_OUT", checkOutDate: { gte: new Date(today.getTime() - 60 * 86_400_000) } }, select: SEL, take: 300 }) as Promise<Bk[]> : Promise.resolve([] as Bk[]),
  ]);

  for (const b of overstays) items.push({ title: `Still in-house after check-out date · ${who(b)}`, subtitle: `Was due out ${short(b.checkOutDate)}. If they left, check them out on the booking; if they stayed, extend — the night audit keeps billing until then.`, href: `/bookings/${b.id}` });
  for (const b of missed) items.push({ title: `Didn't arrive · ${who(b)}`, subtitle: `Due ${short(b.checkInDate)}, not checked in — the night audit will mark it no-show. Still coming? Hold it.`, href: `/bookings/${b.id}`, proposal: { summary: `Hold ${b.code} for a late arrival (no no-show, room kept, billed from ${short(b.checkInDate)}).`, confirmLabel: "Hold booking", command: { action: "holdLate", reservationId: b.id } } });
  for (const b of unassigned) items.push({ title: `No room assigned · ${who(b)}`, subtitle: `Arrives ${short(b.checkInDate)}. Assign a room on the booking, or tell me "${b.code} ko <room> me shift karo".`, href: `/bookings/${b.id}` });
  for (const r of otaStays) {
    if (!r.folio) continue;
    const ota = billParts(r.folio.lines, r.folio.payments, { bookingSource: r.source, extensions: r.extensions }).find((p) => p.part === r.source);
    if (!ota || ota.balancePaise <= 100) continue; // ≤ ₹1 is round-off
    items.push({ title: `${LABEL[r.source] ?? r.source} payment not recorded · ${r.guest.fullName} (${r.code})`, subtitle: `The ${LABEL[r.source]} bill shows ${formatINR(ota.balancePaise)} due. If the OTA has paid, record it.`, href: `/bookings/${r.id}/folio`,
      proposal: { summary: `Record ${formatINR(ota.balancePaise)} as Online / OTA prepaid (${LABEL[r.source]}) on ${r.code}.`, confirmLabel: "Record OTA payment", command: { action: "payment", folioId: r.folio.id, amountPaise: ota.balancePaise, mode: "ONLINE", reference: `${LABEL[r.source]} prepaid — recorded by the PMS Agent` } } });
  }
  const dues = unpaid.map((b) => ({ b, bal: b.folio ? Number(folioBalance(b.folio.lines, b.folio.payments)) : 0 })).filter((x) => x.bal > 100 && !items.some((i) => i.title.includes(x.b.code)));
  for (const { b, bal } of dues.slice(0, 15)) items.push({ title: `Checked out with ${formatINR(bal)} due · ${who(b)}`, subtitle: `Stay ${short(b.checkInDate)} → ${short(b.checkOutDate)}. Collect it (tell me "${b.code} me ${Math.round(bal / 100)} cash/upi jama karo") or correct the bill.`, href: `/bookings/${b.id}/folio` });

  return {
    answer: items.length === 0 ? "I checked stays, arrivals, rooms and bills — nothing needs attention right now." : `${items.length} thing${items.length === 1 ? "" : "s"} need attention:`,
    items, matched: true,
  };
}
