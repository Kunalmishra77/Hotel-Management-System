/**
 * Open a sent message (client, 4 Nov 2026: "owner check kar paye ki mail gaya and
 * kya mail gaya"). Real DB, mock provider: a hand-sent email is opened with its
 * exact body, subject, recipient (masked), sender, sandbox flag and status trail;
 * a role without `communication:send` can't open it.
 */
import { vi } from "vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/lib/db/client";
import type { SessionClaims } from "@/lib/auth/claims";

const h = vi.hoisted(() => ({ user: null as SessionClaims | null }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("no acting user set");
    return h.user;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { ORG_ID, PROP_A_ID, USER_HOUSEKEEPING_ID, USER_RECEPTION_A_ID } from "../../prisma/seed/fixtures";
import { assembleClaims } from "@/lib/auth/claims";
import { encryptString } from "@/lib/crypto/encryption";
import { sendManual } from "@/features/communications/actions";
import { dispatchQueuedMessages } from "@/features/communications/dispatch";
import { getMessageDetail } from "@/features/communications/message-detail";
import { listMessageLog } from "@/features/communications/queries";

const prisma = createPrismaClient();
const GUEST = "md_guest";
const KEY = "MD_INVOICE_TEST";

async function claims(userId: string): Promise<SessionClaims> {
  const c = await assembleClaims(prisma, userId);
  if (!c) throw new Error("no claims");
  return c;
}

beforeAll(async () => {
  await prisma.guest.upsert({
    where: { id: GUEST },
    create: { id: GUEST, orgId: ORG_ID, fullName: "Message Detail Guest", mobile: encryptString("9800000077"), email: encryptString("md.guest@example.com") },
    update: { deletedAt: null },
  });
  await prisma.messageTemplate.upsert({
    where: { orgId_key_channel_language: { orgId: ORG_ID, key: KEY, channel: "EMAIL", language: "en" } },
    create: { orgId: ORG_ID, key: KEY, channel: "EMAIL", language: "en", body: "Dear {{guestName}},\n\nYour invoice {{invoiceNumber}} is attached.", isActive: true },
    update: { isActive: true },
  });
  // No live account for EMAIL in this org → the dispatcher resolves the mock.
  await prisma.messagingAccount.deleteMany({ where: { orgId: ORG_ID, channel: "EMAIL", mode: "live" } });
});

afterAll(async () => {
  await prisma.messageLog.deleteMany({ where: { guestId: GUEST } });
  await prisma.messageTemplate.deleteMany({ where: { orgId: ORG_ID, key: KEY } });
  await prisma.$disconnect();
});

describe("getMessageDetail", () => {
  it("opens a hand-sent email: exact text, subject, masked recipient, who sent it, test-mode flag, trail", async () => {
    h.user = await claims(USER_RECEPTION_A_ID);
    const sent = await sendManual({ guestId: GUEST, propertyId: PROP_A_ID, templateKey: KEY, channel: "EMAIL", language: "en", context: { invoiceNumber: "WASPL-999" } });
    expect(sent.ok, JSON.stringify(sent)).toBe(true);
    await dispatchQueuedMessages(prisma);

    const row = await prisma.messageLog.findFirstOrThrow({ where: { guestId: GUEST, templateKey: KEY }, orderBy: { createdAt: "desc" } });
    const res = await getMessageDetail(row.id);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (!res.ok) return;
    const d = res.data;
    expect(d.body).toBe("Dear Message Detail Guest,\n\nYour invoice WASPL-999 is attached.");
    expect(d.subject).toBe("Woodpecker Apartments & Suites"); // no subject mapped for this key
    expect(d.guestName).toBe("Message Detail Guest");
    expect(d.toAddress).not.toContain("md.guest@example.com"); // masked (FR-15)
    expect(d.sentBy).not.toBeNull(); // the reception user, by hand
    expect(d.sandbox).toBe(true); // mock provider — not actually sent
    expect(d.steps[0]?.status).toBe("QUEUED");
    expect(d.steps.at(-1)?.status).toBe("DELIVERED");

    // The log row carries the same truth.
    const log = await listMessageLog(h.user, { propertyId: PROP_A_ID, limit: 200 });
    const entry = log.find((r) => r.id === row.id);
    expect(entry?.sandbox).toBe(true);
    expect(entry?.guestName).toBe("Message Detail Guest");
  });

  it("is refused for a role without communication:send", async () => {
    const row = await prisma.messageLog.findFirstOrThrow({ where: { guestId: GUEST } });
    h.user = await claims(USER_HOUSEKEEPING_ID);
    const res = await getMessageDetail(row.id);
    expect(res.ok).toBe(false);
  });
});
