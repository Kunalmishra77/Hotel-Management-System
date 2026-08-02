/**
 * 18 T-7 — dynamic-rate SUGGESTIONS (FR-7, AC-8). NOT "use server".
 *
 * `suggestRates(...)` is the public cross-module action that **24** calls. It
 * returns `RateSuggestion[]` computed from grounded occupancy/lead-time/season
 * inputs (never from the model) and emits `RateSuggested` as a notification.
 *
 * 18 NEVER writes `DynamicRate` — 24 persists the `DynamicRate(SUGGESTED)` row
 * and drives human/threshold approval before any rate publishes.
 */
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { emitEvent } from "@/lib/events";
import { NotFoundError } from "@/lib/errors";
import type { SessionClaims } from "@/lib/auth/claims";
import { suggestRateForDate, type RateSuggestion } from "./domain/pricing";
import { withAiContext, logInteraction } from "./internal";

const MAX_DAYS = 60;

function eachDate(from: Date, to: Date): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (d <= end && out.length < MAX_DAYS) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Winter peak placeholder — real season windows are config-driven upstream. */
function isPeak(iso: string): boolean {
  const month = Number(iso.slice(5, 7));
  return month === 11 || month === 12 || month === 1;
}

/**
 * Return rate suggestions for a category over a date range. Requires `ai:use` +
 * property scope. Emits one `RateSuggested` per date; writes NO `DynamicRate`.
 */
export async function suggestRates(
  user: SessionClaims,
  input: { propertyId: string; categoryId: string; from: Date; to: Date },
): Promise<RateSuggestion[]> {
  authorize(user, "ai:use", input.propertyId);
  const scoped = db.scoped(user);

  const category = await scoped.roomCategory.findFirst({
    where: { id: input.categoryId, propertyId: input.propertyId },
    select: { baseRatePaise: true, floorPaise: true, ceilPaise: true },
  });
  if (!category) throw new NotFoundError("Room category not found.");

  const totalRooms = await scoped.room.count({
    where: { propertyId: input.propertyId, categoryId: input.categoryId, isActive: true },
  });

  const today = new Date();
  const dates = eachDate(input.from, input.to);

  const suggestions: RateSuggestion[] = [];
  for (const iso of dates) {
    const dayStart = new Date(`${iso}T00:00:00.000Z`);
    // Grounded occupancy: confirmed/in-house reservations overlapping the night.
    const booked = totalRooms
      ? await scoped.reservation.count({
          where: {
            propertyId: input.propertyId,
            status: { in: ["CONFIRMED", "IN_HOUSE"] },
            checkInDate: { lte: dayStart },
            checkOutDate: { gt: dayStart },
          },
        })
      : 0;
    const occupancy = totalRooms > 0 ? Math.min(1, booked / totalRooms) : 0;
    const leadDays = Math.max(0, Math.round((dayStart.getTime() - today.getTime()) / 86_400_000));
    suggestions.push(
      suggestRateForDate({
        date: iso,
        baseRatePaise: category.baseRatePaise,
        floorPaise: category.floorPaise,
        ceilPaise: category.ceilPaise,
        occupancy,
        leadDays,
        isPeakSeason: isPeak(iso),
      }),
    );
  }

  // Notify 24 (RateSuggested is a notification of the same suggestion). Emitting
  // needs a request context, so bind one when called directly (e.g. by 24/tests).
  await withAiContext(user, () =>
    db.unscoped().$transaction(async (tx) => {
      for (const s of suggestions) {
        await emitEvent(tx, {
          type: "RateSuggested",
          aggregateId: input.categoryId,
          propertyId: input.propertyId,
          payload: { categoryId: input.categoryId, date: s.date, suggestedPaise: s.suggestedPaise },
        });
      }
    }),
  );

  await logInteraction({
    userId: user.userId,
    feature: "generic",
    provider: "grounded",
    rawInput: { propertyId: input.propertyId, categoryId: input.categoryId, dates: dates.length },
    outputRef: `${suggestions.length} suggestions`,
  });

  return suggestions;
}
