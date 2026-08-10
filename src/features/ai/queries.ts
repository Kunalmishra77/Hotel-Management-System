/**
 * 18 AI — read helpers for the Ask-PMS page (no writes, no events). The heavy
 * "generate + log" paths live in the capabilities/actions; these are the
 * cheap, cacheable reads the insight cards render from.
 */
import { db } from "@/lib/db";
import { forecastSeries, type SeriesPoint } from "./domain/forecast";
import type { SessionClaims } from "@/lib/auth/claims";

export type Outlook = { trend: "up" | "down" | "flat"; changePct: number; points: number };

/** A lightweight revenue outlook for the insight card — pure trend, no LLM, no log. */
export async function revenueOutlook(user: SessionClaims, propertyId: string, horizonDays = 14): Promise<Outlook> {
  const rows = await db.scoped(user).dailyStatSnapshot.findMany({
    where: { propertyId },
    select: { businessDate: true, totalRevenuePaise: true },
    orderBy: { businessDate: "asc" },
    take: 180,
  });
  const history: SeriesPoint[] = rows.map((r) => ({
    date: r.businessDate.toISOString().slice(0, 10),
    value: Number(r.totalRevenuePaise),
  }));
  const r = forecastSeries(history, horizonDays);
  return { trend: r.trend, changePct: r.changePct, points: history.length };
}

export type SegmentCard = { id: string; name: string; size: number };

/** The org's advisory segments (12 marketing) — read from cached membership. */
export async function listSegments(user: SessionClaims): Promise<SegmentCard[]> {
  const rows = await db.unscoped().guestSegment.findMany({
    where: { orgId: user.orgId },
    select: { id: true, name: true, guestIds: true },
    orderBy: { name: "asc" },
  });
  return rows.map((s) => ({ id: s.id, name: s.name, size: s.guestIds.length }));
}

/** A segment's cached guest-id membership — the recipient set for a 12 campaign. */
export async function segmentGuestIds(user: SessionClaims, segmentId: string): Promise<string[]> {
  const seg = await db.unscoped().guestSegment.findFirst({
    where: { id: segmentId, orgId: user.orgId },
    select: { guestIds: true },
  });
  return seg?.guestIds ?? [];
}
