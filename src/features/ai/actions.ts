"use server";

/**
 * 18 AI — server-action boundary (api-conventions.md). Thin wrappers: parse →
 * resolve session → delegate to the capability (which authorizes `ai:use` +
 * property scope) → typed Result. The capabilities take explicit claims so they
 * are unit/integration-testable without cookies (like 15's search).
 *
 * There is NO public entry point — every action requires an authenticated staff
 * session (`ai:use`). The guest-site chatbot is module 23.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { toResult, type Result } from "@/lib/result";
import {
  askSchema,
  chatSchema,
  askBusinessSchema,
  forecastSchema,
  suggestRatesSchema,
  classifyFeedbackSchema,
} from "./schema";
import { nlSearch, type NlSearchResult } from "./nl-search";
import { chat, type ChatResult } from "./chat";
import { answerBusinessQuestion, type BusinessAnswer } from "./business-qa";
import { answerAgent, type AgentAnswer } from "./agent";
import { agentCommandSchema } from "./agent-commands";
import { forecast, type ForecastOutput } from "./forecast";
import { suggestRates } from "./pricing";
import { updateSegments, type SegmentSummary } from "./segments";
import { recordFeedbackSentiment, type SentimentLabel } from "./sentiment";
import { withAiContext } from "./internal";
import { db } from "@/lib/db";
import type { RateSuggestion } from "./domain/pricing";

/** NL search: compile → validate (15) → run, masked (AC-4/5). */
export async function askPms(input: unknown): Promise<Result<NlSearchResult>> {
  return toResult(async () => {
    const { text } = askSchema.parse(input);
    const user = await requireUser();
    return nlSearch(user, { text });
  });
}

/** Staff chatbot with read-only tools (AC-3). */
export async function chatWithPms(input: unknown): Promise<Result<ChatResult>> {
  return toResult(async () => {
    const { message } = chatSchema.parse(input);
    const user = await requireUser();
    return chat(user, { message });
  });
}

/** Grounded business Q&A — deterministic, computed from live data (Phase-3 ⑬). */
export async function askBusiness(input: unknown): Promise<Result<BusinessAnswer>> {
  return toResult(async () => {
    const { question } = askBusinessSchema.parse(input);
    const user = await requireUser();
    // Establish the request context (org/scope/requestId in ALS) the canonical
    // financial queries rely on — as every other AI action does.
    return withAiContext(user, () => answerBusinessQuestion(user, { question }));
  });
}

/**
 * PMS Agent — answers any platform question from live data with NO external AI
 * (client, 12 Nov 2026). Powers the floating assistant and the AI page.
 */
export async function askAgent(input: unknown): Promise<Result<AgentAnswer>> {
  return toResult(async () => {
    const { question } = askBusinessSchema.parse(input);
    const user = await requireUser();
    return withAiContext(user, () => answerAgent(user, { question }));
  });
}

/**
 * Run a command the user CONFIRMED in the agent. Dispatches to the very server
 * action the screen uses — each re-validates, re-authorizes, emits its event and
 * writes its audit row — so the agent can never do more than the user's buttons.
 */
export async function runAgentCommand(input: unknown): Promise<Result<{ message: string }>> {
  const gate = await toResult(async () => {
    const user = await requireUser();
    authorize(user, "ai:use");
    return agentCommandSchema.parse(input);
  });
  if (!gate.ok) return gate;
  const cmd = gate.data;
  const done = (r: { ok: boolean; error?: { message: string } }, message: string): Result<{ message: string }> =>
    r.ok ? { ok: true, data: { message } } : { ok: false, error: r.error as never };
  switch (cmd.action) {
    case "extend": {
      const { extendStay } = await import("@/features/reservations/move-actions");
      return done(await extendStay({ reservationId: cmd.reservationId, newCheckOutDate: cmd.newCheckOutDate, ...(cmd.ratePaise ? { ratePaise: cmd.ratePaise } : {}), gstMode: cmd.gstMode, source: cmd.source }), `Extended to ${cmd.newCheckOutDate}. The extra nights are on the bill.`);
    }
    case "checkIn": {
      const { completeCheckIn } = await import("@/features/reservations/check-in-gate");
      return done(await completeCheckIn({ reservationId: cmd.reservationId }), "Checked in. The stay is billed.");
    }
    case "checkOut": {
      const { checkOut } = await import("@/features/reservations/lifecycle-actions");
      return done(await checkOut({ reservationId: cmd.reservationId }), "Checked out. GST invoice(s) issued.");
    }
    case "rate": {
      const { setRoomRate } = await import("@/features/reservations/move-actions");
      return done(await setRoomRate({ reservationId: cmd.reservationId, newRatePaise: cmd.newRatePaise, gstMode: cmd.gstMode }), "Room rate changed and the billed nights re-priced.");
    }
    case "payment": {
      const { recordPayment } = await import("@/features/billing/payment-actions");
      return done(await recordPayment({ folioId: cmd.folioId, tenders: [{ mode: cmd.mode, amountPaise: cmd.amountPaise, ...(cmd.reference ? { reference: cmd.reference } : {}) }], expectedTotalPaise: cmd.amountPaise }), "Payment recorded.");
    }
    case "holdLate":
    case "releaseHold": {
      const { setArrivalGuarantee } = await import("@/features/reservations/late-arrival-actions");
      const r = await setArrivalGuarantee({ reservationId: cmd.reservationId, guaranteed: cmd.action === "holdLate" });
      return done(r, cmd.action === "holdLate" ? (r.ok && r.data.roomRestored ? "Held for late arrival — the room is back on the booking." : "Held for late arrival.") : "Hold removed.");
    }
    case "source": {
      const { changeBookingSource } = await import("@/features/reservations/move-actions");
      return done(await changeBookingSource({ reservationId: cmd.reservationId, source: cmd.source }), "Booking source changed.");
    }
    case "move": {
      const { reallocateRoom } = await import("@/features/reservations/move-actions");
      return done(await reallocateRoom({ reservationId: cmd.reservationId, toRoomId: cmd.toRoomId, ...(cmd.fromRoomId ? { fromRoomId: cmd.fromRoomId } : {}) }), "Room changed.");
    }
    case "roomStatus": {
      const { changeRoomStatus } = await import("@/features/rooms/status-actions");
      return done(await changeRoomStatus({ roomId: cmd.roomId, to: cmd.to, note: "Marked clean via the PMS Agent" }), "Room marked clean — vacant and ready.");
    }
    case "charge": {
      const { postFolioCharge } = await import("@/features/billing/charge-actions");
      return done(await postFolioCharge({ folioId: cmd.folioId, type: cmd.type, description: cmd.description, unitPaise: cmd.unitPaise }), "Charge added to the bill.");
    }
  }
}

/** Revenue/occupancy forecast — numbers grounded, LLM phrases only (AC-7). */
export async function forecastMetric(input: unknown): Promise<Result<ForecastOutput>> {
  return toResult(async () => {
    const data = forecastSchema.parse(input);
    const user = await requireUser();
    return forecast(user, data);
  });
}

/** Rate suggestions (also called directly by 24 with claims) (AC-8). */
export async function suggestRatesAction(input: unknown): Promise<Result<RateSuggestion[]>> {
  return toResult(async () => {
    const data = suggestRatesSchema.parse(input);
    const user = await requireUser();
    return suggestRates(user, data);
  });
}

/** Rebuild advisory guest segments (AC-9). */
export async function updateSegmentsAction(): Promise<Result<SegmentSummary[]>> {
  return toResult(async () => {
    const user = await requireUser();
    return updateSegments(user);
  });
}

/** Manually (re)classify a feedback's sentiment via 12.recordSentiment (AC-6). */
export async function classifyFeedback(input: unknown): Promise<Result<{ label: SentimentLabel; score: number }>> {
  return toResult(async () => {
    const { feedbackId } = classifyFeedbackSchema.parse(input);
    const user = await requireUser();
    // Read-only fetch of the comment (12 owns the row; 18 only reads here).
    const fb = await db.scoped(user).feedback.findFirst({
      where: { id: feedbackId },
      select: { comment: true, propertyId: true },
    });
    authorize(user, "ai:use", fb?.propertyId ?? null);
    const text = fb?.comment ?? "";
    return withAiContext(user, () =>
      recordFeedbackSentiment({ feedbackId, text, propertyId: fb?.propertyId ?? null, userId: user.userId }),
    );
  });
}
