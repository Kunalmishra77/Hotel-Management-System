/**
 * Dynamic-pricing queries — 24 (FR-5, AC-6/10). The public read surface.
 *
 * `getResolvedRate` is THE contract 03/23 call to price a room-night: it reads
 * the APPROVED `DynamicRate` for (category, date) — SUGGESTED rows never publish
 * (AC-10) — plus the category's active `RatePlan`/base tariff, and delegates the
 * "which wins" decision to the pure `resolveRate` chain. It never fails for a
 * missing dynamic rate; the base tariff is the always-present floor of the chain.
 */
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import type { SessionClaims } from "@/lib/auth/claims";
import { resolveRate, type RateSource } from "./domain/resolve";
import { toUtcDate } from "./internal";

export type ResolvedRateResult = { ratePaise: number; source: RateSource };

/**
 * Resolve the nightly rate for a (property, category, date). `negotiatedRatePaise`
 * — a corporate contract rate the caller (03/23) obtained from 25 — wins when
 * present; 24 never calls 25 itself.
 */
export async function getResolvedRate(
  user: SessionClaims,
  input: {
    propertyId: string;
    roomCategoryId: string;
    date: Date;
    negotiatedRatePaise?: number | null;
  },
): Promise<ResolvedRateResult> {
  const scoped = db.scoped(user);
  const day = toUtcDate(input.date);

  const category = await scoped.roomCategory.findFirst({
    where: { id: input.roomCategoryId, propertyId: input.propertyId },
    select: { baseRatePaise: true },
  });
  if (!category) throw new NotFoundError("Room category not found.");

  // Only an APPROVED rate for the exact date publishes (human-in-the-loop, AC-10).
  const dynamic = await scoped.dynamicRate.findFirst({
    where: {
      propertyId: input.propertyId,
      roomCategoryId: input.roomCategoryId,
      date: day,
      status: "APPROVED",
    },
    select: { appliedPaise: true },
  });

  // The category's default rate plan (no per-plan "active" flag in the schema —
  // take the lowest-priced plan as the default; documented so 03/23 match).
  const plan = await scoped.ratePlan.findFirst({
    where: { roomCategoryId: input.roomCategoryId },
    orderBy: { ratePaise: "asc" },
    select: { ratePaise: true },
  });

  return resolveRate({
    negotiatedRatePaise: input.negotiatedRatePaise ?? null,
    dynamicApprovedPaise: dynamic?.appliedPaise ?? null,
    ratePlanPaise: plan?.ratePaise ?? null,
    basePaise: category.baseRatePaise,
  });
}

export type DynamicRateRow = {
  id: string;
  roomCategoryId: string;
  date: Date;
  suggestedPaise: number;
  appliedPaise: number | null;
  status: string;
  reason: string | null;
};

/**
 * The rate calendar for a category over a range — the approve/adjust screen
 * (T-9). Property-scoped; ordered by date for a natural calendar read.
 */
export async function listDynamicRates(
  user: SessionClaims,
  input: { propertyId: string; roomCategoryId: string; from: Date; to: Date },
): Promise<DynamicRateRow[]> {
  const rows = await db.scoped(user).dynamicRate.findMany({
    where: {
      propertyId: input.propertyId,
      roomCategoryId: input.roomCategoryId,
      date: { gte: toUtcDate(input.from), lte: toUtcDate(input.to) },
    },
    select: {
      id: true,
      roomCategoryId: true,
      date: true,
      suggestedPaise: true,
      appliedPaise: true,
      status: true,
      reason: true,
    },
    orderBy: { date: "asc" },
  });
  return rows;
}

export type CategoryGuardrail = {
  id: string;
  name: string;
  baseRatePaise: number;
  floorPaise: number | null;
  ceilPaise: number | null;
};

/** Categories in a property with their guardrails — for the calendar's picker. */
export async function listCategoriesWithGuardrails(
  user: SessionClaims,
  propertyId: string,
): Promise<CategoryGuardrail[]> {
  const rows = await db.scoped(user).roomCategory.findMany({
    where: { propertyId },
    select: { id: true, name: true, baseRatePaise: true, floorPaise: true, ceilPaise: true },
    orderBy: { name: "asc" },
  });
  return rows;
}
