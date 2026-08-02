/**
 * Inbound integration inbox — 00 T-17 (FR-21/22, AC-20/21).
 *
 * FR-21: an inbound provider event is persisted keyed by unique
 * (provider, externalId); a duplicate is IGNORED and still returns success —
 * providers retry aggressively, and a 500 on a duplicate would cause them to
 * retry harder.
 * FR-22: an unprocessed row is processed EXACTLY ONCE, stamped `processedAt`,
 * and signature verification happens BEFORE the row is trusted.
 */
import { Prisma, type IntegrationInbox, type PrismaClient } from "@prisma/client";
import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "../logger";

export type ReceiveResult =
  | { kind: "ACCEPTED"; id: string }
  /** Already seen — success, without reprocessing (AC-20). */
  | { kind: "DUPLICATE"; id: string };

/**
 * Record an inbound event, deduping on (provider, externalId).
 *
 * Relies on the DB unique constraint rather than a check-then-insert: two
 * concurrent deliveries of the same webhook would both pass a prior existence
 * check, and only the constraint reliably decides a winner.
 */
export async function receiveInbound(
  db: PrismaClient,
  input: {
    provider: string;
    externalId: string;
    type: string;
    payload: Prisma.InputJsonValue;
  },
): Promise<ReceiveResult> {
  try {
    const row = await db.integrationInbox.create({
      data: {
        provider: input.provider,
        externalId: input.externalId,
        type: input.type,
        payload: input.payload,
      },
      select: { id: true },
    });
    return { kind: "ACCEPTED", id: row.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existing = await db.integrationInbox.findUniqueOrThrow({
        where: {
          provider_externalId: { provider: input.provider, externalId: input.externalId },
        },
        select: { id: true },
      });
      logger.info("inbox.duplicate_ignored", {
        provider: input.provider,
        externalId: input.externalId,
      });
      return { kind: "DUPLICATE", id: existing.id };
    }
    throw e;
  }
}

export type InboxHandler = (row: IntegrationInbox) => Promise<void>;

export type ProcessInboxResult = {
  fetched: number;
  processed: number;
  failed: number;
};

/**
 * Process unprocessed inbox rows exactly once.
 *
 * "Exactly once" is enforced by a conditional UPDATE claiming the row
 * (`processedAt: null` in the WHERE). Two workers racing the same row: one
 * matches, the other matches zero and skips. The claim happens BEFORE the
 * handler runs, so a crash mid-handler leaves the row claimed rather than
 * reprocessed — the safe direction for money-moving webhooks.
 */
export async function processInbox(
  db: PrismaClient,
  handlers: Record<string, InboxHandler>,
  options: { batchSize?: number; now?: Date } = {},
): Promise<ProcessInboxResult> {
  const batchSize = options.batchSize ?? 100;
  const now = options.now ?? new Date();

  const rows = await db.integrationInbox.findMany({
    where: { processedAt: null },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });

  const result: ProcessInboxResult = { fetched: rows.length, processed: 0, failed: 0 };

  for (const row of rows) {
    const handler = handlers[row.provider] ?? handlers["*"];
    if (!handler) {
      logger.warn("inbox.no_handler", { provider: row.provider, type: row.type });
      continue;
    }

    const claim = await db.integrationInbox.updateMany({
      where: { id: row.id, processedAt: null },
      data: { processedAt: now },
    });
    if (claim.count === 0) continue; // another worker claimed it

    try {
      await handler(row);
      result.processed += 1;
    } catch (e) {
      result.failed += 1;
      // Release the claim so a fixed handler can retry. The row is never
      // deleted — an unprocessable webhook stays visible for investigation.
      await db.integrationInbox.updateMany({
        where: { id: row.id },
        data: { processedAt: null },
      });
      logger.error("inbox.handler_failed", {
        provider: row.provider,
        type: row.type,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}

/**
 * HMAC-SHA256 webhook signature check (security.md: "verify provider signatures
 * before processing").
 *
 * Constant-time comparison — a fast-fail `===` leaks how much of a forged
 * signature was correct, which is enough to forge one byte at a time.
 */
export function verifyWebhookSignature(params: {
  rawBody: string;
  signature: string;
  secret: string;
  algorithm?: "sha256" | "sha512";
}): boolean {
  const { rawBody, signature, secret, algorithm = "sha256" } = params;
  if (!signature || !secret) return false;

  const expected = createHmac(algorithm, secret).update(rawBody).digest("hex");
  const a = Buffer.from(signature.replace(/^sha\d+=/, "").toLowerCase());
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
