"use server";

/**
 * One sent message, opened in full (client, 4 Nov 2026: "owner check kar paye ki
 * mail gaya and kya mail gaya — open kar paye"; same for WhatsApp later). Returns
 * what went out (subject + the exact rendered body), to whom (guest name + masked
 * address, FR-15), when, how it was triggered and by whom, and the status trail
 * (queued → sent → delivered/read, or failed with the reason).
 *
 * The body is not on the MessageLog row by design — it lives on the append-only
 * `MessageQueued` event the outbox wrote (outbox.ts), which is the exact text the
 * dispatcher handed to the provider. Property-scoped; `communication:send`.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { maskEmail, maskMobile } from "@/lib/crypto/encryption";
import { emailSubject } from "@/lib/messaging/subjects";
import { listMessageLog, isSandboxRef } from "./queries";

export type MessageStep = { at: string; status: string; by: string | null };

export type MessageDetail = {
  id: string;
  channel: string;
  templateKey: string | null;
  category: string | null;
  propertyName: string | null;
  guestId: string | null;
  guestName: string | null;
  toAddress: string;
  fromAddress: string | null;
  subject: string | null;
  /** Null when the message could not be built (e.g. a missing detail) — nothing was sent. */
  body: string | null;
  status: string;
  error: string | null;
  sandbox: boolean;
  attempts: number;
  createdAt: string;
  scheduledFor: string | null;
  /** Staff member who sent it by hand; null = sent automatically by the system. */
  sentBy: string | null;
  steps: MessageStep[];
};

export async function getMessageDetail(messageId: string): Promise<Result<MessageDetail>> {
  return toResult(async () => {
    const user = await requireUser();
    const m = await db.scoped(user).messageLog.findFirst({ where: { id: messageId } });
    if (!m) throw new NotFoundError("Message not found.");
    authorize(user, "communication:send", m.propertyId);

    const [event, audits, guest, property] = await Promise.all([
      m.triggeredByEvent ? db.unscoped().domainEvent.findUnique({ where: { id: m.triggeredByEvent }, select: { payload: true } }) : null,
      db.unscoped().auditLog.findMany({
        where: { orgId: user.orgId, entityType: "MessageLog", entityId: m.id },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true, after: true, user: { select: { name: true } } },
      }),
      m.guestId ? db.unscoped().guest.findFirst({ where: { id: m.guestId, orgId: user.orgId }, select: { fullName: true } }) : null,
      m.propertyId ? db.unscoped().property.findFirst({ where: { id: m.propertyId }, select: { name: true } }) : null,
    ]);

    const payload = (event?.payload ?? null) as Record<string, unknown> | null;
    const body = typeof payload?.body === "string" ? payload.body : null;

    // Status trail from the audit rows the outbox/dispatcher wrote. Delivery/read
    // receipts arrive by provider webhook without an audit row, so the current
    // status is appended at its last-change time when the trail doesn't end on it.
    const steps: MessageStep[] = audits.map((a) => ({
      at: a.createdAt.toISOString(),
      status: String((a.after as Record<string, unknown> | null)?.status ?? "QUEUED"),
      by: a.user?.name ?? null,
    }));
    if (steps.length === 0) steps.push({ at: m.createdAt.toISOString(), status: "QUEUED", by: null });
    if (steps[steps.length - 1]?.status !== m.status) steps.push({ at: m.updatedAt.toISOString(), status: m.status, by: null });

    return {
      id: m.id,
      channel: m.channel,
      templateKey: m.templateKey,
      category: m.category,
      propertyName: property?.name ?? null,
      guestId: m.guestId,
      guestName: guest?.fullName ?? null,
      toAddress: (m.channel === "EMAIL" ? maskEmail(m.toAddress) : maskMobile(m.toAddress)) ?? "•••",
      fromAddress: m.channel === "EMAIL" ? (process.env.SMTP_FROM ?? process.env.SMTP_USER ?? null) : null,
      subject: m.channel === "EMAIL" ? emailSubject(m.templateKey) : null,
      body,
      status: m.status,
      error: m.error,
      sandbox: isSandboxRef(m.providerRef),
      attempts: m.attempts,
      createdAt: m.createdAt.toISOString(),
      scheduledFor: m.scheduledFor?.toISOString() ?? null,
      // The first audit row is the enqueue: a person's name there means a hand send.
      sentBy: audits[0]?.user?.name ?? null,
      steps,
    };
  });
}

/** "Load older" for the message log — the next page before `before` (newest first). */
export async function loadOlderMessages(input: { before: string; propertyId?: string | null }) {
  return toResult(async () => {
    const user = await requireUser();
    authorize(user, "communication:send", input.propertyId ?? null);
    const before = new Date(input.before);
    if (Number.isNaN(before.getTime())) throw new NotFoundError("Bad cursor.");
    return listMessageLog(user, input.propertyId ? { propertyId: input.propertyId, limit: 100, before } : { limit: 100, before });
  });
}
