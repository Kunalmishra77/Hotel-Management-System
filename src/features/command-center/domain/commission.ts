/**
 * OTA channel commission — pure. Owners judge a channel by NET revenue (after the
 * OTA's cut), not gross. These are indicative Indian-market rates for the demo;
 * in production they become per-channel/per-property config (an ADR + a rate
 * table). Direct/corporate/phone/website/walk-in carry no commission.
 */
export const OTA_COMMISSION_BPS: Record<string, number> = {
  BOOKING_COM: 1800, // 18%
  MAKEMYTRIP: 2000, // 20%
  GOIBIBO: 1800, // 18%
  AGODA: 1800, // 18%
  AIRBNB: 1500, // 15%
  TRAVEL_AGENT: 1000, // 10% agent commission
};

/** Commission (paise) an OTA takes on a source's gross revenue. 0 for direct channels. */
export function commissionPaise(source: string, revenuePaise: number): number {
  const bps = OTA_COMMISSION_BPS[source] ?? 0;
  return Math.round((revenuePaise * bps) / 10_000);
}

/** Total commission cost + net revenue across a revenue-by-source breakdown. */
export function netAfterCommission(
  bySource: { source: string; revenuePaise: number }[],
  grossPaise: number,
): { commissionPaise: number; netPaise: number } {
  const commission = bySource.reduce((a, s) => a + commissionPaise(s.source, s.revenuePaise), 0);
  return { commissionPaise: commission, netPaise: grossPaise - commission };
}
