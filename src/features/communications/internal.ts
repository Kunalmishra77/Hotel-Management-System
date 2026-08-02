/**
 * Shared internals for 12-communications. NOT a "use server" module.
 *
 * Most comms tables are ORG-scoped (MessageTemplate/Automation/Campaign/
 * Consent/MessagingAccount), so writes run on the UNSCOPED client inside a
 * request/system context (for emitEvent/writeAudit orgId) — the same pattern as
 * 15-search's internals. MessageLog/Feedback carry propertyId but are created
 * with an explicit propertyId, so the scope extension passes creates through.
 */
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";
import { decryptOptional } from "@/lib/crypto/encryption";
import type { Channel } from "@prisma/client";
import type { SessionClaims } from "@/lib/auth/claims";

/** Org-scoped comms writes/reads use the unscoped client under a request context. */
export function commsDb() {
  return db.unscoped();
}

export function withCommsContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
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

export type GuestContact = {
  id: string;
  fullName: string;
  mobile: string | null; // encrypted at rest
  whatsapp: string | null;
  email: string | null;
};

/** Load a guest (org-scoped) with the encrypted contact columns. */
export async function loadGuest(orgId: string, guestId: string): Promise<GuestContact | null> {
  const g = await db.unscoped().guest.findFirst({
    where: { id: guestId, orgId },
    select: { id: true, fullName: true, mobile: true, whatsapp: true, email: true },
  });
  return g ?? null;
}

/**
 * The recipient address for a channel, DECRYPTED for the provider only.
 *
 * PII minimization (FR-15): this value is used solely as `toAddress` and the
 * provider recipient — it is never logged. WhatsApp prefers the dedicated
 * whatsapp number, falling back to mobile.
 */
export function resolveToAddress(channel: Channel, guest: GuestContact): string | null {
  switch (channel) {
    case "WHATSAPP":
      return decryptOptional(guest.whatsapp) ?? decryptOptional(guest.mobile);
    case "SMS":
      return decryptOptional(guest.mobile);
    case "EMAIL":
      return decryptOptional(guest.email);
  }
}

export type PropertyMerge = {
  id: string;
  name: string;
  city: string;
  timezone: string;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  wifiSsid: string | null;
  wifiPassword: string | null;
  houseRules: string | null;
  emergencyContact: string | null;
  locationMapUrl: string | null;
  checkInInstructions: string | null;
};

/** Load the §11 per-property merge content + quiet-hours config (FR-24/FR-21). */
export async function loadProperty(propertyId: string): Promise<PropertyMerge | null> {
  const p = await db.unscoped().property.findUnique({
    where: { id: propertyId },
    select: {
      id: true,
      name: true,
      city: true,
      timezone: true,
      quietHoursStart: true,
      quietHoursEnd: true,
      wifiSsid: true,
      wifiPassword: true,
      houseRules: true,
      emergencyContact: true,
      locationMapUrl: true,
      checkInInstructions: true,
    },
  });
  return p ?? null;
}

/** Active automations whose trigger is this domain event type (org-scoped). */
export async function activeAutomationsForEvent(orgId: string, eventType: string) {
  return db.unscoped().messageAutomation.findMany({
    where: { orgId, triggerEvent: eventType, isActive: true },
  });
}

/** All active scheduled automations (a `scheduleOffsetMinutes`, no trigger event). */
export async function activeScheduledAutomations(orgId: string) {
  return db.unscoped().messageAutomation.findMany({
    where: { orgId, isActive: true, triggerEvent: null, scheduleOffsetMinutes: { not: null } },
  });
}

/** The exact template for (org,key,channel,language), only if active. */
export async function resolveTemplate(orgId: string, key: string, channel: Channel, language: string) {
  const t = await db.unscoped().messageTemplate.findUnique({
    where: { orgId_key_channel_language: { orgId, key, channel, language } },
  });
  return t && t.isActive ? t : null;
}

/** All active templates for a key (for language fallback resolution, FR-8). */
export async function templatesForKey(orgId: string, key: string) {
  return db.unscoped().messageTemplate.findMany({ where: { orgId, key, isActive: true } });
}

/** The messaging account config for a channel (provider + sandbox/live mode). */
export async function resolveAccount(orgId: string, channel: Channel) {
  return db.unscoped().messagingAccount.findFirst({ where: { orgId, channel } });
}

/** Marketing consent status for (guest,channel), or null when no row exists. */
export async function loadConsentStatus(guestId: string, channel: Channel) {
  const row = await db.unscoped().communicationConsent.findUnique({
    where: { guestId_channel: { guestId, channel } },
  });
  return row?.marketingStatus ?? null;
}
