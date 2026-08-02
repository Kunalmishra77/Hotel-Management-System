/**
 * 24 T-5 — the suggestion engine (FR-1, AC-1/2/8). NOT a "use server" module;
 * it runs as a pg-boss job (scripts/worker.ts) and is callable directly by an
 * authorized user or a test.
 *
 * What it does per (category, date) in the range:
 *   1. Computes a GROUNDED suggestion with 24's own deterministic model
 *      (`domain/suggest`) from real occupancy/lead-time/season — base-safe when
 *      occupancy data is missing (AC-8: fall back to base, never divide-by-zero).
 *   2. Best-effort invokes `18.suggestRates` so the AI layer's `RateSuggested`
 *      event fires for the same window (FR-1 "optionally calling 18"). 18 writes
 *      NO `DynamicRate`; 24 owns the row. A failure there (no `ai:use`, provider
 *      down) is swallowed — the grounded suggestion still persists.
 *   3. UPSERTS a `DynamicRate(SUGGESTED)` — creating it, or refreshing an
 *      existing SUGGESTED row. An APPROVED/REJECTED row is left untouched, so a
 *      re-run never clobbers a human decision (AC-11) and never auto-applies.
 */
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { suggestRates as aiSuggestRates } from "@/features/ai/pricing";
import type { SessionClaims } from "@/lib/auth/claims";
import { suggestRate, clampToGuardrail } from "./domain/suggest";
import { pricingDb, withPricingContext, toUtcDate } from "./internal";
import { runPricingEngineSchema } from "./schema";

const MAX_DAYS = 90;

/** UTC-midnight dates across an inclusive range, capped so a job can't run away. */
function eachDay(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const d = toUtcDate(from);
  const end = toUtcDate(to);
  while (d <= end && out.length < MAX_DAYS) {
    out.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Winter peak placeholder — real season windows are config-driven upstream (matches 18). */
function isPeak(date: Date): boolean {
  const m = date.getUTCMonth() + 1;
  return m === 11 || m === 12 || m === 1;
}

export type RunPricingEngineResult = { categories: number; suggested: number };

export async function runPricingEngine(
  user: SessionClaims,
  rawInput: unknown,
): Promise<RunPricingEngineResult> {
  const input = runPricingEngineSchema.parse(rawInput);
  // Suggestions curate published pricing — gate the run to pricing managers.
  authorize(user, "pricing:approve", input.propertyId);

  const scoped = pricingDb(user);
  const categories = await scoped.roomCategory.findMany({
    where: {
      propertyId: input.propertyId,
      ...(input.roomCategoryId ? { id: input.roomCategoryId } : {}),
    },
    select: { id: true, baseRatePaise: true, floorPaise: true, ceilPaise: true },
  });

  const days = eachDay(input.from, input.to);
  const today = toUtcDate(new Date());
  let suggested = 0;

  for (const cat of categories) {
    const totalRooms = await scoped.room.count({
      where: { propertyId: input.propertyId, categoryId: cat.id, isActive: true },
    });

    // Per-date grounded suggestion (base-safe when occupancy is unknown, AC-8).
    const rows: { date: Date; suggestedPaise: number; reason: string }[] = [];
    for (const day of days) {
      if (totalRooms === 0) {
        // No sellable rooms ⇒ no occupancy signal: publish the base tariff,
        // clamped to the guardrail. Never crash, never divide by zero (AC-8).
        rows.push({
          date: day,
          suggestedPaise: clampToGuardrail(cat.baseRatePaise, cat.floorPaise, cat.ceilPaise),
          reason: "base (no occupancy data)",
        });
        continue;
      }
      const booked = await scoped.reservation.count({
        where: {
          propertyId: input.propertyId,
          status: { in: ["CONFIRMED", "IN_HOUSE"] },
          checkInDate: { lte: day },
          checkOutDate: { gt: day },
        },
      });
      const occupancyBps = Math.min(10_000, Math.round((booked / totalRooms) * 10_000));
      const leadTimeDays = Math.max(
        0,
        Math.round((day.getTime() - today.getTime()) / 86_400_000),
      );
      const s = suggestRate({
        basePaise: cat.baseRatePaise,
        occupancyBps,
        leadTimeDays,
        isPeakSeason: isPeak(day),
        floorPaise: cat.floorPaise,
        ceilPaise: cat.ceilPaise,
      });
      rows.push({ date: day, suggestedPaise: s.suggestedPaise, reason: s.reason });
    }

    // Best-effort: let 18 emit RateSuggested for the same window (FR-1). Its
    // numbers are advisory; 24's grounded model is what persists.
    try {
      await aiSuggestRates(user, {
        propertyId: input.propertyId,
        categoryId: cat.id,
        from: input.from,
        to: input.to,
      });
    } catch (e) {
      logger.warn("pricing.ai_suggest_unavailable", {
        categoryId: cat.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    suggested += await persistSuggestions(user, input.propertyId, cat.id, rows);
  }

  return { categories: categories.length, suggested };
}

/**
 * Upsert SUGGESTED rows for one category. Refreshes an existing SUGGESTED row;
 * leaves APPROVED/REJECTED rows untouched (AC-11). Returns how many rows were
 * created or refreshed.
 */
async function persistSuggestions(
  user: SessionClaims,
  propertyId: string,
  roomCategoryId: string,
  rows: { date: Date; suggestedPaise: number; reason: string }[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const scoped = pricingDb(user);

  return withPricingContext(user, () =>
    scoped.$transaction(async (tx) => {
      let count = 0;
      for (const row of rows) {
        const existing = await tx.dynamicRate.findFirst({
          where: { propertyId, roomCategoryId, date: row.date },
          select: { id: true, status: true },
        });

        if (!existing) {
          await tx.dynamicRate.create({
            data: {
              propertyId,
              roomCategoryId,
              date: row.date,
              suggestedPaise: row.suggestedPaise,
              status: "SUGGESTED",
              reason: row.reason,
            },
          });
          count += 1;
        } else if (existing.status === "SUGGESTED") {
          // Refresh the live suggestion only — never resurrect a decided row.
          await tx.dynamicRate.updateMany({
            where: { id: existing.id },
            data: { suggestedPaise: row.suggestedPaise, reason: row.reason },
          });
          count += 1;
        }
      }

      // One audit row per category run (RateSuggested is emitted by 18 above).
      await writeAudit(tx, {
        action: "pricing:suggest",
        entityType: "DynamicRate",
        entityId: roomCategoryId,
        propertyId,
        after: { roomCategoryId, count, from: rows[0]?.date, to: rows[rows.length - 1]?.date },
      });

      return count;
    }),
  );
}
