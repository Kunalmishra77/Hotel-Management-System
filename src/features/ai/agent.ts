/**
 * PMS Agent (client, 12 Nov 2026) — the assistant that answers anything about
 * THIS platform with NO external AI API: who's arriving / leaving / staying, who
 * is in a room, which rooms are free, a guest's or booking's stay and balance,
 * dues / revenue / occupancy, and how to do something in the app.
 *
 * domain/agent-intents.ts understands the question; this file answers it from
 * live data with the caller's own property scope and permissions (read-only —
 * it never changes anything), and links each result to its screen.
 * NOT "use server": called by the askAgent action and by tests with claims.
 */
import { db } from "@/lib/db";
import { authorize, hasPermission } from "@/lib/permissions";
import { formatINR } from "@/lib/utils";
import { arrivalsDeparturesPortfolio, inHousePortfolio } from "@/features/reservations/queries";
import { folioBalance } from "@/features/billing";
import { answerBusinessQuestion } from "./business-qa";
import { classify, GUIDE } from "./domain/agent-intents";
import { parseCommand } from "./domain/agent-commands";
import { proposeCommand, type AgentProposal } from "./agent-commands";
export { AGENT_SUGGESTIONS } from "./domain/agent-intents";
import type { SessionClaims } from "@/lib/auth/claims";

export type AgentItem = { title: string; subtitle: string; href?: string; proposal?: AgentProposal };
export type AgentAnswer = {
  answer: string;
  items?: AgentItem[];
  steps?: string[];
  /** An action the agent will take when the user presses Confirm (nothing runs before). */
  proposal?: AgentProposal;
  matched: boolean;
  scopeLabel: string;
};


const short = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const STATUS: Record<string, string> = { ENQUIRY: "Enquiry", CONFIRMED: "Confirmed", IN_HOUSE: "In-house", CHECKED_OUT: "Checked out", CANCELLED: "Cancelled", NO_SHOW: "No-show" };

function todayIn(offsetDays = 0): Date {
  const s = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return new Date(Date.parse(`${s}T00:00:00Z`) + offsetDays * 86_400_000);
}

const BOOKING_SELECT = {
  id: true, code: true, status: true, checkInDate: true, checkOutDate: true, nights: true, source: true, arrivalGuaranteed: true,
  guest: { select: { fullName: true } },
  property: { select: { name: true } },
  allocations: { select: { room: { select: { number: true } } } },
  folio: { select: { lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } }, payments: { select: { amountPaise: true, isRefund: true } } } },
} as const;

type BookingRow = {
  id: string; code: string; status: string; checkInDate: Date; checkOutDate: Date; nights: number; source: string; arrivalGuaranteed: boolean;
  guest: { fullName: string }; property: { name: string }; allocations: { room: { number: string } }[];
  folio: { lines: { amountPaise: bigint; cgstPaise: number; sgstPaise: number; igstPaise: number }[]; payments: { amountPaise: bigint; isRefund: boolean }[] } | null;
};

function bookingItem(r: BookingRow, canMoney: boolean): AgentItem {
  const rooms = r.allocations.map((a) => a.room.number).join(", ") || "no room";
  const bal = canMoney && r.folio ? Number(folioBalance(r.folio.lines, r.folio.payments)) : null;
  return {
    title: `${r.guest.fullName} · ${r.code}`,
    subtitle: `${STATUS[r.status] ?? r.status}${r.arrivalGuaranteed ? " (late arrival held)" : ""} · ${r.property.name} · ${rooms} · ${short(r.checkInDate)} → ${short(r.checkOutDate)} (${r.nights} night${r.nights === 1 ? "" : "s"}) · ${r.source.replace(/_/g, " ")}${bal !== null ? ` · balance ${formatINR(bal)}` : ""}`,
    href: `/bookings/${r.id}`,
  };
}

/** Answer one question. `ai:use` gates entry; each answer re-checks its own permission. */
export async function answerAgent(user: SessionClaims, input: { question: string }): Promise<AgentAnswer> {
  authorize(user, "ai:use");
  const ids = user.activePropertyId ? [user.activePropertyId] : [...user.accessiblePropertyIds];
  const scopeLabel = user.activePropertyId ? "this property" : `all ${ids.length} properties`;
  const canView = hasPermission(user, "reservation:view");
  const canMoney = hasPermission(user, "folio:view");
  const noView: AgentAnswer = { answer: "You don't have permission to view bookings.", matched: true, scopeLabel };

  // An instruction ("BK-… ko 8 Dec tak extend karo") becomes a confirmable plan.
  const today = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}T00:00:00Z`);
  const command = parseCommand(input.question, today);
  if (command) {
    if (!canView) return noView;
    const p = await proposeCommand(user, command);
    return { ...p, scopeLabel };
  }

  const intent = classify(input.question);

  switch (intent.kind) {
    case "help":
      return {
        answer: "I answer from this platform's live data — no outside internet. Ask me, in English or Hindi:",
        steps: [
          "Arrivals / check-outs today or tomorrow — \"aaj kaun aa raha hai\", \"kal ke check-out\"",
          "Who is staying now, or who is in a room — \"2F-3 me kaun hai\"",
          "Free rooms — \"khali rooms\"",
          "A guest or booking — type the name or the BK- code (stay, room, balance)",
          "Dues, revenue, expenses, profit, occupancy, cancellations, rooms to clean",
          `How to do something — ${GUIDE.slice(0, 6).map((g) => g.title.toLowerCase()).join(", ")}…`,
          "Do it for you (you confirm first): \"BK-… ko 8 Dec tak extend karo\", \"2F-3 check out\", \"BK-… me 2535 cash jama karo\", \"BK-… ka rate 6000 karo\", \"BK-… ko 3F-1 me shift karo\", \"2F-2 clean ho gaya\", \"BK-… dinner 300 add karo\", \"BK-… source MMT karo\", \"BK-… late arrival hold karo\"",
          "Find problems and fix them — \"koi galti hai kya check karo\"",
        ],
        matched: false,
        scopeLabel,
      };

    case "guide":
      return { answer: `${intent.topic.title}:`, steps: intent.topic.steps, matched: true, scopeLabel };

    case "business": {
      const b = await answerBusinessQuestion(user, { question: input.question });
      return { answer: b.answer, items: b.breakdown?.map((x) => ({ title: x.label, subtitle: x.value })), matched: b.matched, scopeLabel: b.scopeLabel };
    }

    case "arrivals":
    case "departures": {
      if (!canView) return noView;
      const day = todayIn(intent.dayOffset);
      const { arrivals, departures } = await arrivalsDeparturesPortfolio(user, ids, day);
      const list = intent.kind === "arrivals" ? arrivals : departures;
      const when = intent.dayOffset === 1 ? "tomorrow" : "today";
      const what = intent.kind === "arrivals" ? "arriving" : "checking out";
      return {
        answer: list.length === 0 ? `No one is ${what} ${when} across ${scopeLabel}.` : `${list.length} guest${list.length === 1 ? " is" : "s are"} ${what} ${when} across ${scopeLabel}:`,
        items: list.map((m) => ({ title: `${m.guestName} · ${m.code}`, subtitle: `${m.propertyName} · ${m.rooms || "no room"}${canMoney ? ` · balance ${formatINR(m.balancePaise)}` : ""}`, href: `/bookings/${m.id}` })),
        matched: true,
        scopeLabel,
      };
    }

    case "inHouse": {
      if (!canView) return noView;
      const h = await inHousePortfolio(user, ids);
      return {
        answer: h.total === 0 ? `No one is staying right now across ${scopeLabel}.` : `${h.total} guest${h.total === 1 ? " is" : "s are"} staying right now across ${scopeLabel}:`,
        items: h.rows.slice(0, 40).map((r) => ({ title: `${r.guestName} · ${r.code}`, subtitle: `${r.propertyName} · ${r.rooms} · until ${short(r.checkOutDate)}${canMoney ? ` · balance ${formatINR(r.balancePaise)}` : ""}`, href: `/bookings/${r.id}` })),
        matched: true,
        scopeLabel,
      };
    }

    case "vacant": {
      const rooms = await db.scoped(user).room.findMany({
        where: { propertyId: { in: ids }, isActive: true, status: "VACANT" },
        select: { number: true, property: { select: { name: true } } },
        orderBy: [{ propertyId: "asc" }, { number: "asc" }],
      });
      const byProp = new Map<string, string[]>();
      for (const r of rooms) byProp.set(r.property.name, [...(byProp.get(r.property.name) ?? []), r.number]);
      return {
        answer: rooms.length === 0 ? `No room is vacant right now across ${scopeLabel}.` : `${rooms.length} room${rooms.length === 1 ? " is" : "s are"} vacant right now across ${scopeLabel}:`,
        items: [...byProp.entries()].map(([p, nums]) => ({ title: p, subtitle: nums.join(", "), href: "/rooms" })),
        matched: true,
        scopeLabel,
      };
    }

    case "room": {
      if (!canView) return noView;
      const rooms = await db.scoped(user).room.findMany({
        where: { propertyId: { in: ids }, number: { equals: intent.room, mode: "insensitive" } },
        select: { id: true, number: true, status: true, property: { select: { name: true } } },
      });
      if (rooms.length === 0) return { answer: `I couldn't find a room called ${intent.room} in ${scopeLabel}.`, matched: true, scopeLabel };
      const today = todayIn();
      const items: AgentItem[] = [];
      for (const room of rooms) {
        const cur = await db.scoped(user).reservation.findFirst({
          where: { allocations: { some: { roomId: room.id, startDate: { lte: today }, endDate: { gt: today } } }, status: { in: ["IN_HOUSE", "CONFIRMED"] } },
          select: BOOKING_SELECT,
        });
        if (cur) { items.push(bookingItem(cur as BookingRow, canMoney)); continue; }
        const next = await db.scoped(user).reservation.findFirst({
          where: { allocations: { some: { roomId: room.id, startDate: { gt: today } } }, status: "CONFIRMED" },
          orderBy: { checkInDate: "asc" },
          select: { id: true, code: true, checkInDate: true, guest: { select: { fullName: true } } },
        });
        items.push({
          title: `${room.number} · ${room.property.name}`,
          subtitle: `Nobody in it now (${room.status.toLowerCase().replace(/_/g, " ")})${next ? ` · next: ${next.guest.fullName} from ${short(next.checkInDate)}` : ""}`,
          href: next ? `/bookings/${next.id}` : "/rooms",
        });
      }
      return { answer: `Room ${intent.room}:`, items, matched: true, scopeLabel };
    }

    case "booking": {
      if (!canView) return noView;
      const r = await db.scoped(user).reservation.findFirst({ where: { code: intent.code }, select: BOOKING_SELECT });
      if (!r) return { answer: `No booking ${intent.code} in ${scopeLabel}.`, matched: true, scopeLabel };
      return { answer: `Booking ${intent.code}:`, items: [bookingItem(r as BookingRow, canMoney)], matched: true, scopeLabel };
    }

    case "guest": {
      if (!canView) return noView;
      const words = intent.name.split(" ").filter((w) => w.length >= 3);
      const tryFind = (where: object) => db.scoped(user).reservation.findMany({
        where: { propertyId: { in: ids }, ...where }, select: BOOKING_SELECT, orderBy: { checkInDate: "desc" }, take: 30,
      }) as Promise<BookingRow[]>;
      let rows = await tryFind({ guest: { fullName: { contains: intent.name, mode: "insensitive" } } });
      if (rows.length === 0 && words.length) {
        rows = await tryFind({ OR: words.map((w) => ({ guest: { fullName: { contains: w, mode: "insensitive" } } })) });
        // Best match first: the booking whose guest name holds the most of the words.
        const hits = (r: BookingRow) => words.filter((w) => r.guest.fullName.toLowerCase().includes(w)).length;
        rows.sort((a, b) => hits(b) - hits(a));
      }
      if (rows.length === 0) {
        return { answer: `I couldn't find a guest matching "${intent.name}" in ${scopeLabel}. Try the guest's name, a booking code (BK-…), a room (2F-3), or ask "help".`, matched: false, scopeLabel };
      }
      // Current / upcoming stays first, then the latest past ones.
      const rank = (s: string) => (s === "IN_HOUSE" ? 0 : s === "CONFIRMED" ? 1 : 2);
      rows.sort((a, b) => rank(a.status) - rank(b.status));
      const shown = rows.slice(0, 8);
      return {
        answer: `${rows.length} booking${rows.length === 1 ? "" : "s"} found for "${intent.name}"${rows.length > shown.length ? ` (showing ${shown.length})` : ""}:`,
        items: shown.map((r) => bookingItem(r, canMoney)),
        matched: true,
        scopeLabel,
      };
    }
  }
}
