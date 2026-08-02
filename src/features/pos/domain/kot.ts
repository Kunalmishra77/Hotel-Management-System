/**
 * Kitchen prep aggregation — 19 POS (FR-13, AC-12). Pure. The kitchen view shows
 * one aggregated prep line per menu item across all open orders, so the line can
 * cook "12 × Masala Dosa" rather than scan twelve tickets.
 */
export type PrepInput = {
  name: string;
  menuItemId: string | null;
  quantity: number;
};

export type PrepLine = {
  key: string;
  name: string;
  quantity: number;
};

/** Aggregate open-order items into a per-item prep list, sorted by name. */
export function aggregatePrep(items: readonly PrepInput[]): PrepLine[] {
  const byKey = new Map<string, PrepLine>();
  for (const it of items) {
    // Distinct custom lines (no menuItemId) aggregate by name.
    const key = it.menuItemId ?? `name:${it.name}`;
    const existing = byKey.get(key);
    if (existing) existing.quantity += it.quantity;
    else byKey.set(key, { key, name: it.name, quantity: it.quantity });
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}
