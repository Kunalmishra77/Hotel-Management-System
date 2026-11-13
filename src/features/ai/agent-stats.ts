/**
 * PMS Agent — counting questions ("2026 mei kitne customers aaye", "is mahine
 * kitni bookings", "pichle mahine kitne room-nights") answered from live data
 * (client, 13 Nov 2026). Read-only, hotel-scoped, `reservation:view`.
 *
 * Definitions (one way, so the answer matches the screens):
 *  - check-in / stay   = a booking that actually arrived (IN_HOUSE or CHECKED_OUT)
 *                        whose check-in date falls in the period;
 *  - guests            = distinct guests across those stays; "returning" = had
 *                        an earlier stay before the period;
 *  - room-nights       = nights of arrived stays that fall inside the period,
 *                        per room (a 2-room booking counts both rooms);
 *  - bookings          = every non-enquiry booking whose check-in date is in the
 *                        period, split by outcome.
 */
import { db } from "@/lib/db";
import type { SessionClaims } from "@/lib/auth/claims";
import type { Period, StatsMetric } from "./domain/agent-intents";

export type StatsAnswer = { answer: string; items: { title: string; subtitle: string; href?: string }[] };

const DAY = 86_400_000;
const n = (x: number, one: string, many = `${one}s`) => `${x.toLocaleString("en-IN")} ${x === 1 ? one : many}`;
const SOURCE: Record<string, string> = {
  DIRECT: "Direct", WALK_IN: "Walk-in", PHONE: "Phone", WEBSITE: "Website", CORPORATE: "Corporate", TRAVEL_AGENT: "Travel agent",
  MAKEMYTRIP: "MakeMyTrip", GOIBIBO: "Goibibo", BOOKING_COM: "Booking.com", AGODA: "Agoda", AIRBNB: "Airbnb",
};

export async function answerStats(
  user: SessionClaims,
  hotelIds: string[],
  scopeLabel: string,
  metric: StatsMetric,
  period: Period,
): Promise<StatsAnswer> {
  const scoped = db.scoped(user);
  const [rows, nightAllocs] = await Promise.all([
    scoped.reservation.findMany({
      where: { propertyId: { in: hotelIds }, status: { not: "ENQUIRY" }, checkInDate: { gte: period.from, lt: period.to } },
      select: { status: true, guestId: true, source: true, property: { select: { name: true } } },
    }),
    scoped.roomAllocation.findMany({
      where: {
        startDate: { lt: period.to },
        endDate: { gt: period.from },
        reservation: { propertyId: { in: hotelIds }, status: { in: ["IN_HOUSE", "CHECKED_OUT"] } },
      },
      select: { startDate: true, endDate: true },
    }),
  ]);

  const stayed = rows.filter((r) => r.status === "IN_HOUSE" || r.status === "CHECKED_OUT");
  const upcoming = rows.filter((r) => r.status === "CONFIRMED").length;
  const cancelled = rows.filter((r) => r.status === "CANCELLED").length;
  const noShow = rows.filter((r) => r.status === "NO_SHOW").length;
  const guestIds = [...new Set(stayed.map((r) => r.guestId))];
  const returning = guestIds.length
    ? await scoped.reservation.groupBy({
        by: ["guestId"],
        where: { guestId: { in: guestIds }, propertyId: { in: hotelIds }, status: { in: ["IN_HOUSE", "CHECKED_OUT"] }, checkInDate: { lt: period.from } },
      }).then((g) => g.length)
    : 0;
  const roomNights = nightAllocs.reduce((sum, a) => {
    const from = Math.max(a.startDate.getTime(), period.from.getTime());
    const to = Math.min(a.endDate.getTime(), period.to.getTime());
    return sum + Math.max(0, Math.round((to - from) / DAY));
  }, 0);

  const where = `in ${period.label} across ${scopeLabel}`;
  const answer =
    metric === "guests"
      ? `${n(guestIds.length, "different guest")} stayed with you ${where} — ${n(stayed.length, "check-in")} in all${returning ? `, ${returning} of them returning guests` : ""}.`
      : metric === "checkins"
        ? `${n(stayed.length, "check-in")} ${where}, by ${n(guestIds.length, "different guest")}.`
        : metric === "nights"
          ? `${n(roomNights, "room-night")} sold ${where}.`
          : metric === "cancellations"
            ? `${n(cancelled, "booking")} cancelled and ${n(noShow, "no-show", "no-shows")} for stays ${where}.`
            : `${n(rows.length, "booking")} for stays ${where}: ${stayed.length} arrived, ${upcoming} still to come, ${cancelled} cancelled, ${noShow} no-show.`;

  const items: StatsAnswer["items"] = [
    { title: "Summary", subtitle: `${n(stayed.length, "check-in")} · ${n(guestIds.length, "guest")} (${returning} returning) · ${n(roomNights, "room-night")} · ${upcoming} upcoming · ${cancelled} cancelled · ${noShow} no-show`, href: "/reports" },
  ];
  const byHotel = new Map<string, { stays: number; guests: Set<string> }>();
  for (const r of stayed) {
    const h = byHotel.get(r.property.name) ?? { stays: 0, guests: new Set<string>() };
    h.stays += 1;
    h.guests.add(r.guestId);
    byHotel.set(r.property.name, h);
  }
  for (const [name, h] of [...byHotel.entries()].sort((a, b) => b[1].stays - a[1].stays)) {
    items.push({ title: name, subtitle: `${n(h.stays, "check-in")} · ${n(h.guests.size, "guest")}` });
  }
  const bySource = new Map<string, number>();
  for (const r of stayed) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  if (bySource.size) {
    items.push({
      title: "By source",
      subtitle: [...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([s, c]) => `${SOURCE[s] ?? s.replace(/_/g, " ")} ${c}`).join(" · "),
    });
  }
  return { answer, items };
}

/** Collapse a word to its consonant skeleton so "jelebi" finds "Jalebi". */
const skeleton = (w: string) => w.toLowerCase().replace(/[^a-z]/g, "").replace(/[aeiouy]/g, "").replace(/(.)\1+/g, "$1");

/** The price of an item on the POS menu, fuzzy-matched by name. */
export async function answerPrice(
  user: SessionClaims,
  hotelIds: string[],
  scopeLabel: string,
  item: string,
): Promise<StatsAnswer & { matched: boolean }> {
  const menu = await db.scoped(user).menuItem.findMany({
    where: { propertyId: { in: hotelIds }, isActive: true },
    select: { name: true, ratePaise: true, gstBps: true, outlet: { select: { name: true } } },
  });
  if (menu.length === 0) {
    return {
      answer: `There's no menu set up yet in ${scopeLabel}, so I can't tell the price of "${item}". Add items under POS → Menu, then ask again.`,
      items: [],
      matched: false,
    };
  }
  const wanted = item.split(" ").map(skeleton).filter((k) => k.length >= 2);
  const hits = menu.filter((m) => {
    const name = m.name.toLowerCase();
    const keys = name.split(/\s+/).map(skeleton);
    return wanted.some((w) => keys.includes(w) || name.includes(item));
  });
  const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  if (hits.length === 0) {
    return {
      answer: `"${item}" is not on the menu in ${scopeLabel}. Items on the menu:`,
      items: menu.slice(0, 12).map((m) => ({ title: m.name, subtitle: `${rupees(m.ratePaise)} + ${m.gstBps / 100}% GST · ${m.outlet.name}`, href: "/pos" })),
      matched: false,
    };
  }
  return {
    answer: hits.length === 1 ? `${hits[0]!.name} costs ${rupees(hits[0]!.ratePaise)} + ${hits[0]!.gstBps / 100}% GST.` : `${hits.length} menu items match "${item}":`,
    items: hits.map((m) => ({ title: m.name, subtitle: `${rupees(m.ratePaise)} + ${m.gstBps / 100}% GST · ${m.outlet.name}`, href: "/pos" })),
    matched: true,
  };
}
