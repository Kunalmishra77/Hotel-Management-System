/**
 * 12-communications read surface (queries.ts). Plain reads for server components;
 * the calling page authorizes first (see app/(dashboard)/communications).
 *
 * Config tables (template/automation/campaign) are org-scoped; message history is
 * property-scoped and read through `db.scoped(user)` so it honours the caller's
 * property boundary and stays within list budgets via the
 * `MessageLog(propertyId, createdAt)` index.
 */
import { db } from "@/lib/db";
import { maskEmail, maskMobile } from "@/lib/crypto/encryption";
import type { Channel } from "@prisma/client";
import type { SessionClaims } from "@/lib/auth/claims";

/** Mask a stored recipient address for display (FR-15 — never raw in the UI). */
function maskAddress(channel: Channel, value: string): string {
  return (channel === "EMAIL" ? maskEmail(value) : maskMobile(value)) ?? "•••";
}

export async function listTemplates(user: SessionClaims) {
  return db.unscoped().messageTemplate.findMany({
    where: { orgId: user.orgId },
    orderBy: [{ key: "asc" }, { channel: "asc" }, { language: "asc" }],
  });
}

export async function listAutomations(user: SessionClaims) {
  return db.unscoped().messageAutomation.findMany({
    where: { orgId: user.orgId },
    orderBy: [{ category: "asc" }, { templateKey: "asc" }],
  });
}

export async function listCampaigns(user: SessionClaims, limit = 50) {
  return db.unscoped().campaign.findMany({
    where: { orgId: user.orgId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
  });
}

export async function listMessageLog(
  user: SessionClaims,
  input: { propertyId: string; status?: string; channel?: Channel; limit?: number },
) {
  const rows = await db.scoped(user).messageLog.findMany({
    where: {
      propertyId: input.propertyId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.channel ? { channel: input.channel } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(input.limit ?? 50, 200),
    select: { id: true, channel: true, category: true, templateKey: true, toAddress: true, status: true, providerRef: true, error: true, deadLetteredAt: true, createdAt: true },
  });
  // Never surface the raw recipient address to the UI (FR-15).
  return rows.map((r) => ({ ...r, toAddress: maskAddress(r.channel, r.toAddress) }));
}

/** Campaign builder preview: how many recipients are marketing-eligible (FR-14). */
export async function consentPreview(
  user: SessionClaims,
  input: { channel: Channel; recipientGuestIds: string[] },
) {
  const optedOut = await db.unscoped().communicationConsent.count({
    where: { channel: input.channel, marketingStatus: "OPTED_OUT", guestId: { in: input.recipientGuestIds } },
  });
  return { total: input.recipientGuestIds.length, optedOut, eligible: input.recipientGuestIds.length - optedOut };
}
