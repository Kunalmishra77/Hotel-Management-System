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

/**
 * Message history. One property when `propertyId` is set, else across `propertyIds`
 * (Phase-3 ⑩ — the all-hotels log defaults to every accessible property so the page
 * is never empty). Property-scoped either way; recipient addresses masked (FR-15).
 * Each row carries its property name so the all-hotels view can label the hotel.
 */
export async function listMessageLog(
  user: SessionClaims,
  input: { propertyId?: string; propertyIds?: string[]; status?: string; channel?: Channel; limit?: number; before?: Date },
) {
  const ids = input.propertyId
    ? [input.propertyId]
    : (input.propertyIds ?? [...user.accessiblePropertyIds]).filter((id) => user.accessiblePropertyIds.includes(id));
  if (ids.length === 0) return [];
  const rows = await db.scoped(user).messageLog.findMany({
    where: {
      propertyId: { in: ids },
      ...(input.status ? { status: input.status } : {}),
      ...(input.channel ? { channel: input.channel } : {}),
      // Cursor for "Load older" — the page is newest-first.
      ...(input.before ? { createdAt: { lt: input.before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(input.limit ?? 50, 200),
    select: { id: true, propertyId: true, guestId: true, channel: true, category: true, templateKey: true, toAddress: true, status: true, providerRef: true, error: true, deadLetteredAt: true, createdAt: true },
  });
  const propIds = [...new Set(rows.map((r) => r.propertyId).filter((id): id is string => id !== null))];
  const guestIds = [...new Set(rows.map((r) => r.guestId).filter((id): id is string => id !== null))];
  const [props, guests] = await Promise.all([
    db.unscoped().property.findMany({ where: { id: { in: propIds } }, select: { id: true, name: true } }),
    db.unscoped().guest.findMany({ where: { id: { in: guestIds } }, select: { id: true, fullName: true } }),
  ]);
  const nameById = new Map(props.map((p) => [p.id, p.name]));
  const guestById = new Map(guests.map((g) => [g.id, g.fullName]));
  // Never surface the raw recipient address to the UI (FR-15).
  return rows.map(({ providerRef, guestId, ...r }) => ({
    ...r,
    toAddress: maskAddress(r.channel, r.toAddress),
    guestName: guestId ? (guestById.get(guestId) ?? null) : null,
    // The sandbox provider marks its "sends" mock-*: nothing actually left the
    // building, so the UI must not let "Delivered" read as a real delivery.
    sandbox: isSandboxRef(providerRef),
    propertyName: r.propertyId ? (nameById.get(r.propertyId) ?? r.propertyId) : undefined,
  }));
}

/** True when a send went to the sandbox (mock) provider — no real message left. */
export function isSandboxRef(providerRef: string | null): boolean {
  return providerRef?.startsWith("mock-") ?? false;
}

/**
 * A single guest's communication history (#24 "Conversation") — every automated
 * or manual message sent to this guest across channels, newest first. Recipient
 * address is masked (FR-15). Property-scoped.
 */
export async function listGuestMessages(user: SessionClaims, guestId: string, limit = 50) {
  const rows = await db.scoped(user).messageLog.findMany({
    where: { guestId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
    select: { id: true, channel: true, category: true, templateKey: true, toAddress: true, status: true, providerRef: true, createdAt: true },
  });
  return rows.map(({ providerRef, ...r }) => ({ ...r, toAddress: maskAddress(r.channel, r.toAddress), sandbox: isSandboxRef(providerRef) }));
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
