/**
 * 18 — grounded business Q&A (Phase-3 ⑬). The client wants a manager assistant that
 * ACTUALLY answers operational questions ("today's dues?", "which property is
 * fullest?", "rooms to clean?", "this month's revenue?"). Per ai-features.md the
 * numbers must come from the DB, never the model — so this is a DETERMINISTIC
 * resolver over the canonical queries (no LLM, works with the default mock
 * provider). It classifies the question by keyword, computes from real data with
 * the caller's own scope and permissions, and returns a precise answer plus an
 * optional per-property breakdown. Read-only; never mutates.
 *
 * NOT "use server": exported for the action + tests with explicit claims.
 */
import { authorize, hasPermission } from "@/lib/permissions";
import { formatINR } from "@/lib/utils";
import { getPortfolio, perPropertyBillingRollup, portfolioBookingCounts } from "@/features/command-center/queries";
import { housekeepingPortfolio } from "@/features/housekeeping/queries";
import type { SessionClaims } from "@/lib/auth/claims";

export type BusinessAnswer = {
  answer: string;
  breakdown?: { label: string; value: string }[];
  scopeLabel: string;
  matched: boolean;
};

const SUGGESTIONS = [
  "Today's pending dues?",
  "Which property is fullest?",
  "This month's revenue?",
  "This month's expenses and profit?",
  "How many rooms to clean?",
  "Cancellations this month?",
  "Who is staying right now?",
] as const;

export const BUSINESS_QA_SUGGESTIONS: readonly string[] = SUGGESTIONS;

const has = (q: string, ...words: string[]) => words.some((w) => q.includes(w));

/** Answer a business question from real data. `ai:use` gates entry. */
export async function answerBusinessQuestion(
  user: SessionClaims,
  input: { question: string },
): Promise<BusinessAnswer> {
  authorize(user, "ai:use");
  const q = input.question.trim().toLowerCase();
  const ids = user.activePropertyId ? [user.activePropertyId] : [...user.accessiblePropertyIds];
  const scopeLabel = user.activePropertyId ? "this property" : `all ${ids.length} properties`;
  const canMoney = hasPermission(user, "report:view-financial");
  const money = (msg: string): BusinessAnswer => ({ answer: msg, scopeLabel, matched: true });

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const needMoney = (): BusinessAnswer | null =>
    canMoney ? null : { answer: "You don't have permission to view financial figures.", scopeLabel, matched: true };

  // — Housekeeping (no financial permission needed) —
  if (has(q, "clean", "dirty", "housekeep", "to-clean")) {
    const rows = await housekeepingPortfolio(user, ids);
    const total = rows.reduce((n, r) => n + r.toClean, 0);
    return {
      answer: total === 0 ? `No rooms are waiting to be cleaned across ${scopeLabel}.` : `${total} room(s) waiting to be cleaned across ${scopeLabel}.`,
      breakdown: rows.filter((r) => r.toClean + r.inProgress > 0).map((r) => ({ label: r.propertyName, value: `${r.toClean} to clean · ${r.inProgress} in progress` })),
      scopeLabel,
      matched: true,
    };
  }

  // — Dues / outstanding —
  if (has(q, "due", "outstanding", "owe", "pending payment", "pending due", "collect")) {
    const blocked = needMoney(); if (blocked) return blocked;
    const roll = await perPropertyBillingRollup(user, ids);
    return {
      ...money(`Pending dues across ${scopeLabel}: ${formatINR(roll.totals.outstandingPaise)} across ${roll.totals.unsettledFolios} unsettled folio(s). Collected today: ${formatINR(roll.totals.collectedTodayPaise)}.`),
      breakdown: roll.rows.filter((r) => r.outstandingPaise > 0).map((r) => ({ label: r.name, value: formatINR(r.outstandingPaise) })),
    };
  }

  // — Occupancy / fullest / busiest / emptiest —
  if (has(q, "occupanc", "fullest", "busiest", "full", "empt", "vacant")) {
    const blocked = needMoney(); if (blocked) return blocked;
    const pf = await getPortfolio(user, monthStart, now);
    if (pf.properties.length === 0) return money("No properties in scope.");
    const sorted = [...pf.properties].sort((a, b) => b.occupancyBps - a.occupancyBps);
    const top = sorted[0]!;
    const bottom = sorted[sorted.length - 1]!;
    const wantEmpty = has(q, "empt", "vacant");
    const lead = wantEmpty
      ? `${bottom.name} is the emptiest at ${(bottom.occupancyBps / 100).toFixed(0)}% occupancy (month-to-date).`
      : `${top.name} is the fullest at ${(top.occupancyBps / 100).toFixed(0)}% occupancy (month-to-date). Portfolio average: ${(pf.totals.occupancyBps / 100).toFixed(0)}%.`;
    return {
      ...money(lead),
      breakdown: sorted.map((p) => ({ label: p.name, value: `${(p.occupancyBps / 100).toFixed(0)}%` })),
    };
  }

  // — Cancellations / no-shows / bookings / in-house —
  if (has(q, "cancel", "no-show", "no show", "noshow", "booking", "staying", "in-house", "in house", "checked in")) {
    const blocked = needMoney(); if (blocked) return blocked;
    const c = await portfolioBookingCounts(user, { propertyIds: ids, from: monthStart, to: now });
    if (has(q, "staying", "in-house", "in house", "checked in")) {
      return money(`${c.inHouse} guest(s) are checked in right now across ${scopeLabel}.`);
    }
    return money(`This month across ${scopeLabel}: ${c.bookings} realised booking(s), ${c.cancelled} cancellation(s), ${c.noShow} no-show(s) — a ${c.cancelRatePct}% drop-off rate. ${c.inHouse} staying now.`);
  }

  // — Money: revenue / expenses / profit —
  if (has(q, "revenue", "income", "earn", "sales", "expense", "spend", "cost", "profit")) {
    const blocked = needMoney(); if (blocked) return blocked;
    const pf = await getPortfolio(user, monthStart, now);
    const t = pf.totals;
    if (has(q, "profit")) {
      return { ...money(`Month-to-date profit across ${scopeLabel}: ${formatINR(t.profitPaise)} (revenue ${formatINR(t.revenuePaise)} − expenses ${formatINR(t.expensePaise)}).`), breakdown: pf.properties.map((p) => ({ label: p.name, value: formatINR(p.revenuePaise) })) };
    }
    if (has(q, "expense", "spend", "cost")) {
      return money(`Month-to-date expenses across ${scopeLabel}: ${formatINR(t.expensePaise)}. Revenue ${formatINR(t.revenuePaise)}, profit ${formatINR(t.profitPaise)}.`);
    }
    return { ...money(`Month-to-date revenue across ${scopeLabel}: ${formatINR(t.revenuePaise)} (ex-tax, net of discounts). ADR ${formatINR(t.adrPaise)}, RevPAR ${formatINR(t.revparPaise)}.`), breakdown: pf.properties.map((p) => ({ label: p.name, value: formatINR(p.revenuePaise) })) };
  }

  // — Fallback: say what it can answer (don't guess). —
  return {
    answer: "I can answer questions about dues, revenue, expenses, profit, occupancy, cancellations, who's staying, and rooms to clean — all from live data. Try one of the suggestions.",
    scopeLabel,
    matched: false,
  };
}
