/**
 * 18 T-6 — revenue/occupancy forecast (FR-6, AC-7). NOT "use server".
 *
 * GROUNDING OVER GENERATION: the numbers come from the immutable daily snapshots
 * via a deterministic time-series model (`domain/forecast`). The LLM is handed
 * the already-computed figures and asked ONLY to phrase a narrative — it never
 * produces a number. If the provider is unavailable, the numbers still stand and
 * a deterministic fallback narrative is used.
 */
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { getLLMProvider } from "@/lib/ai";
import { isDomainError } from "@/lib/errors";
import type { SessionClaims } from "@/lib/auth/claims";
import { forecastSeries, type ForecastResult, type SeriesPoint } from "./domain/forecast";
import { logInteraction } from "./internal";

const SYSTEM = "You are a hotel revenue analyst. Phrase a one-paragraph narrative for the figures given. Do not invent or change any number.";

export type ForecastOutput = ForecastResult & { narrative: string; metric: "revenue" | "occupancy" };

export async function forecast(
  user: SessionClaims,
  input: { propertyId: string; metric: "revenue" | "occupancy"; horizonDays: number },
): Promise<ForecastOutput> {
  authorize(user, "ai:use", input.propertyId);
  // Revenue is a money path — require the financial-report permission too (FR-9/10).
  if (input.metric === "revenue") authorize(user, "report:view-financial", input.propertyId);

  const rows = await db.scoped(user).dailyStatSnapshot.findMany({
    where: { propertyId: input.propertyId },
    select: { businessDate: true, totalRevenuePaise: true, occupancyBps: true },
    orderBy: { businessDate: "asc" },
    take: 180,
  });

  const history: SeriesPoint[] = rows.map((r) => ({
    date: r.businessDate.toISOString().slice(0, 10),
    value: input.metric === "revenue" ? Number(r.totalRevenuePaise) : r.occupancyBps,
  }));

  const result = forecastSeries(history, input.horizonDays);

  // The facts we hand the model are pre-computed — grounding (FR-6).
  const facts =
    `Metric ${input.metric}. History points ${history.length}. Trend ${result.trend}. ` +
    `Projected change ${result.changePct}% over ${input.horizonDays} days.`;

  let narrative: string;
  let provider = "mock";
  try {
    const r = await getLLMProvider().complete({
      system: SYSTEM,
      messages: [{ role: "user", content: facts }],
      feature: "forecast",
    });
    provider = r.provider;
    narrative = r.text || fallbackNarrative(result, input.metric, input.horizonDays);
  } catch (e) {
    // Provider outage must never block the insight — degrade to a deterministic line.
    if (!isDomainError(e)) throw e;
    narrative = fallbackNarrative(result, input.metric, input.horizonDays);
  }

  await logInteraction({
    userId: user.userId,
    feature: "forecast",
    provider,
    rawInput: { propertyId: input.propertyId, metric: input.metric, horizonDays: input.horizonDays },
    outputRef: `${input.metric} ${result.trend} ${result.changePct}%`,
  });

  return { ...result, narrative, metric: input.metric };
}

function fallbackNarrative(r: ForecastResult, metric: string, horizon: number): string {
  const dir = r.trend === "up" ? "increase" : r.trend === "down" ? "decrease" : "hold steady";
  return `${metric} is projected to ${dir} by about ${Math.abs(r.changePct)}% over the next ${horizon} days.`;
}
