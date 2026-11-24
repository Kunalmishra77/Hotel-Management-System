/**
 * What the OTA will actually pay for ONE stay (client, 24 Nov 2026 — V S Sastry,
 * Expedia: "the folio says ₹6,297.92 paid online, but Expedia pays ₹4,798.40").
 * The bill and the "Online" payment are the guest's price (GST is due on it); the
 * OTA keeps its commission/fees and remits the rest. Same split and the same
 * per-channel rules as Reports → Channels, so the two never disagree.
 */
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { activeLines, lineSource, billPartLabel, OTA_SOURCES } from "@/features/billing";
import { otaDeduction, type Deduction } from "./domain/ota-deduction";
import { channelDeductionRules } from "./register-queries";
import type { SessionClaims } from "@/lib/auth/claims";

export type OtaPayout = Deduction & { source: string; label: string; basePaise: number; gstPaise: number; ruleSet: boolean; extraFeeLabel: string | null };

export async function otaPayoutForStay(user: SessionClaims, reservationId: string): Promise<OtaPayout[]> {
  const r = await db.scoped(user).reservation.findFirst({
    where: { id: reservationId },
    select: {
      propertyId: true, source: true,
      extensions: { select: { fromDate: true, toDate: true, source: true } },
      folio: { select: { lines: { select: { id: true, type: true, description: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, businessDate: true, revision: true, reversalOfId: true } } } },
    },
  });
  if (!r?.folio) return [];
  authorize(user, "report:view-financial", r.propertyId);
  const all = r.folio.lines;
  const byId = new Map(all.map((l) => [l.id, l]));
  const ctx = { bookingSource: r.source, extensions: r.extensions };
  const sums = new Map<string, { base: number; gst: number }>();
  for (const l of activeLines(all)) {
    const s = lineSource(l, byId, ctx);
    if (!OTA_SOURCES.has(s)) continue;
    const a = sums.get(s) ?? { base: 0, gst: 0 };
    a.base += Number(l.amountPaise); a.gst += l.cgstPaise + l.sgstPaise + l.igstPaise;
    sums.set(s, a);
  }
  if (sums.size === 0) return [];
  const rules = await channelDeductionRules(user);
  return [...sums.entries()].filter(([, v]) => v.base > 0).map(([source, v]) => {
    const rule = rules[source]!;
    return { ...otaDeduction(v.base, v.gst, rule), source, label: billPartLabel(source), basePaise: v.base, gstPaise: v.gst, ruleSet: rule.set, extraFeeLabel: rule.extraFeeLabel ?? null };
  });
}
