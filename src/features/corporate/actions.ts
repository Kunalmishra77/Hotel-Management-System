"use server";

/**
 * Corporate CRM actions — 25 T-7/T-8 (FR-1/4/8, AC-1/2/12). Canonical write path:
 * zod.parse → requireUser → authorize(corporate:manage) → transaction → emit
 * event → audit → typed Result.
 *
 * `Corporate`/`TravelAgent`/`NegotiatedRate` are ORG-level master data, so the
 * authorization is permission-only (propertyId=null) — there is no property to
 * scope a corporate to. Credit is NOT settled here: 06 calls the `reserveCredit`/
 * `releaseCredit` services (index.ts) inside its own settlement transaction.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { corporateDb, withCorporateContext } from "./internal";
import { CORPORATE_EVENTS } from "./events";
import { createCorporateSchema, createAgentSchema, setNegotiatedRateSchema } from "./schema";

export type CorporateResult = { id: string; name: string };
export type AgentResult = { id: string; name: string };
export type NegotiatedRateResult = { id: string; ratePaise: number };

/** Create a corporate account with its credit limit (FR-1, AC-1). */
export async function createCorporate(input: unknown): Promise<Result<CorporateResult>> {
  return toResult(async () => {
    const data = createCorporateSchema.parse(input);
    const user = await requireUser();
    authorize(user, "corporate:manage", null); // org-level master data (AC-12)

    return withCorporateContext(user, () =>
      corporateDb(user).$transaction(async (tx) => {
        const corp = await tx.corporate.create({
          data: {
            orgId: user.orgId,
            name: data.name,
            gstin: data.gstin ?? null,
            contactName: data.contactName ?? null,
            contactPhone: data.contactPhone ?? null,
            contactEmail: data.contactEmail ?? null,
            creditLimitPaise: data.creditLimitPaise,
          },
          select: { id: true, name: true },
        });
        await emitEvent(tx, {
          type: CORPORATE_EVENTS.corporateCreated,
          aggregateId: corp.id,
          payload: { name: corp.name, creditLimitPaise: Number(data.creditLimitPaise) },
        });
        await writeAudit(tx, {
          action: "corporate:create",
          entityType: "Corporate",
          entityId: corp.id,
          after: { name: corp.name, gstin: data.gstin ?? null, creditLimitPaise: Number(data.creditLimitPaise) },
        });
        return corp;
      }),
    );
  });
}

/** Create a travel agent with its commission rate (FR-1/6, AC-1). */
export async function createAgent(input: unknown): Promise<Result<AgentResult>> {
  return toResult(async () => {
    const data = createAgentSchema.parse(input);
    const user = await requireUser();
    authorize(user, "corporate:manage", null); // AC-12

    return withCorporateContext(user, () =>
      corporateDb(user).$transaction(async (tx) => {
        const agent = await tx.travelAgent.create({
          data: {
            orgId: user.orgId,
            name: data.name,
            commissionBps: data.commissionBps,
            contactPhone: data.contactPhone ?? null,
          },
          select: { id: true, name: true },
        });
        await emitEvent(tx, {
          type: CORPORATE_EVENTS.agentCreated,
          aggregateId: agent.id,
          payload: { name: agent.name, commissionBps: data.commissionBps },
        });
        await writeAudit(tx, {
          action: "agent:create",
          entityType: "TravelAgent",
          entityId: agent.id,
          after: { name: agent.name, commissionBps: data.commissionBps },
        });
        return agent;
      }),
    );
  });
}

/**
 * Set (upsert) a corporate's negotiated rate for a room category (FR-4, AC-2).
 * `getNegotiatedRate` (queries.ts) is the read path 03/23 use to pass this into
 * `24.resolveRate`, where the negotiated rate wins the resolution chain.
 */
export async function setNegotiatedRate(input: unknown): Promise<Result<NegotiatedRateResult>> {
  return toResult(async () => {
    const data = setNegotiatedRateSchema.parse(input);
    const user = await requireUser();
    authorize(user, "corporate:manage", null); // AC-12

    const client = corporateDb(user);
    // Guard the FK + org boundary before writing (the corporate must be ours).
    const corp = await client.corporate.findFirst({
      where: { id: data.corporateId, orgId: user.orgId },
      select: { id: true },
    });
    if (!corp) throw new NotFoundError("Corporate account not found.");

    return withCorporateContext(user, () =>
      client.$transaction(async (tx) => {
        const rate = await tx.negotiatedRate.upsert({
          where: { corporateId_roomCategoryId: { corporateId: data.corporateId, roomCategoryId: data.roomCategoryId } },
          create: { corporateId: data.corporateId, roomCategoryId: data.roomCategoryId, ratePaise: data.ratePaise },
          update: { ratePaise: data.ratePaise },
          select: { id: true, ratePaise: true },
        });
        await emitEvent(tx, {
          type: CORPORATE_EVENTS.negotiatedRateSet,
          aggregateId: data.corporateId,
          payload: { corporateId: data.corporateId, roomCategoryId: data.roomCategoryId, ratePaise: data.ratePaise },
        });
        await writeAudit(tx, {
          action: "corporate:set-negotiated-rate",
          entityType: "NegotiatedRate",
          entityId: rate.id,
          after: { corporateId: data.corporateId, roomCategoryId: data.roomCategoryId, ratePaise: data.ratePaise },
        });
        return rate;
      }),
    );
  });
}
