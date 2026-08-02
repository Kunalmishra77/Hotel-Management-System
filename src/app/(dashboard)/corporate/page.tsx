import type { Metadata } from "next";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { listCorporates, listAgents, corporateStatement, agentCommission, type CorporateStatement } from "@/features/corporate/queries";
import { CorporateScreen } from "@/features/corporate/components/corporate-screen";

export const metadata: Metadata = { title: "Corporate" };

/** 25 T-13 — corporate/agent master data, credit gauge, statement, commission. */
export default async function CorporatePage() {
  const user = await requirePermission("corporate:manage");
  const canSeeMoney = hasPermission(user, "report:view-financial");

  const [corporates, agents] = await Promise.all([listCorporates(user), listAgents(user)]);

  // Financial detail (statements + commission) only for report:view-financial (AC-8).
  let statements: CorporateStatement[] = [];
  let commission: Awaited<ReturnType<typeof agentCommission>> = [];
  if (canSeeMoney) {
    const from = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
    const to = new Date();
    const propertyIds = user.accessiblePropertyIds;
    const [stmts, comm] = await Promise.all([
      Promise.all(corporates.map((c) => corporateStatement(user, { corporateId: c.id }))),
      propertyIds.length ? agentCommission(user, { propertyIds, from, to }) : Promise.resolve([]),
    ]);
    statements = stmts.filter((s): s is CorporateStatement => s !== null);
    commission = comm;
  }

  return (
    <CorporateScreen
      corporates={corporates}
      agents={agents}
      statements={statements}
      commission={commission}
      canSeeMoney={canSeeMoney}
    />
  );
}
