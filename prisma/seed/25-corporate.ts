/**
 * 25 · Corporate CRM — T-2 seed fixtures.
 *
 * specs/25-corporate-crm/user-stories.md § Test Fixtures. ACME (corporate,
 * ₹2,00,000 limit) is already seeded by 03-reservations. This adds:
 *   - TA-SKY  — travel agent, 10% commission (1000 bps)
 *   - NEG-DLX — ACME's negotiated Deluxe rate ₹3,500 (wins the 24 rate chain)
 *
 * ACME's `receivablePaise` is deliberately NOT set here — it is written only by
 * 06 via `reserveCredit`/`releaseCredit` (business-rules.md). Ids are declared
 * locally rather than in the shared `fixtures.ts` to avoid churn on that file.
 */
import type { PrismaClient } from "@prisma/client";
import { CORPORATE_ACME_ID, CAT_DLX_ID, ORG_ID } from "./fixtures";

/** TA-SKY — travel agent, 10% commission. */
export const TRAVEL_AGENT_SKY_ID = "agent_sky";
/** NEG-DLX — ACME's negotiated Deluxe rate, ₹3,500 (paise). */
export const NEGOTIATED_ACME_DLX_ID = "neg_acme_dlx";
const NEG_DLX_RATE_PAISE = 350_000;

export async function seedCorporate(prisma: PrismaClient): Promise<void> {
  await prisma.travelAgent.upsert({
    where: { id: TRAVEL_AGENT_SKY_ID },
    create: {
      id: TRAVEL_AGENT_SKY_ID,
      orgId: ORG_ID,
      name: "Sky Travels",
      commissionBps: 1000, // 10%
      contactPhone: "9800000010",
    },
    update: { name: "Sky Travels", commissionBps: 1000 },
  });

  await prisma.negotiatedRate.upsert({
    where: { corporateId_roomCategoryId: { corporateId: CORPORATE_ACME_ID, roomCategoryId: CAT_DLX_ID } },
    create: {
      id: NEGOTIATED_ACME_DLX_ID,
      corporateId: CORPORATE_ACME_ID,
      roomCategoryId: CAT_DLX_ID,
      ratePaise: NEG_DLX_RATE_PAISE,
    },
    update: { ratePaise: NEG_DLX_RATE_PAISE },
  });
}
