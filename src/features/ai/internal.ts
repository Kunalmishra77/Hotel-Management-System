/**
 * 18 AI — shared internals. NOT a "use server" module.
 *
 * `logInteraction` writes the `AiInteractionLog` audit row (FR-9): who, which
 * feature, which provider, and the REDACTED input — never raw PII, never the raw
 * model output. `outputRef` is a short non-PII summary (a count, a label), not
 * the content itself.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";
import { redactValue } from "@/lib/ai";
import type { SessionClaims } from "@/lib/auth/claims";
import type { AiFeature } from "@/lib/ai";

export function withAiContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
  return runWithContext(
    {
      orgId: user.orgId,
      userId: user.userId,
      propertyScope: user.propertyScope,
      activePropertyId: user.activePropertyId,
      requestId: newRequestId(),
      ip: null,
      device: null,
    },
    fn,
  );
}

/** Append an AiInteractionLog row (FR-9). Redacts the input; stores no raw output/PII. */
export async function logInteraction(input: {
  userId: string | null;
  feature: AiFeature;
  provider: string;
  rawInput: unknown;
  outputRef: string;
}): Promise<void> {
  await db.unscoped().aiInteractionLog.create({
    data: {
      userId: input.userId,
      feature: input.feature,
      provider: input.provider,
      inputRedacted: redactValue(input.rawInput) as Prisma.InputJsonValue,
      outputRef: input.outputRef,
    },
  });
}
