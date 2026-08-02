/**
 * 15 T-9 — typed result cards (FR-3, AC-1). Presentational; each links to its
 * entity where a route exists. All fields are already masked by the server.
 */
import Link from "next/link";
import type { SearchResult } from "../types";

const HREF: Partial<Record<SearchResult["entity"], (id: string) => string>> = {
  guest: (id) => `/guests/${id}`,
  reservation: (id) => `/bookings/${id}`,
};

const LABEL: Record<SearchResult["entity"], string> = {
  guest: "guest",
  reservation: "booking",
  invoice: "invoice",
  expense: "expense",
  staff: "staff",
};

export function ResultCards({ results, query }: { results: SearchResult[]; query: string }) {
  if (!query) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Type to search across the property.</p>;
  }
  if (results.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground" data-testid="search-empty">No results for “{query}”.</p>;
  }
  return (
    <ul className="space-y-2" data-testid="search-results">
      {results.map((r) => {
        const href = HREF[r.entity]?.(r.id);
        const inner = (
          <div className="flex items-center justify-between gap-3 rounded-md border p-3" data-testid={`result-${r.entity}`}>
            <div className="min-w-0">
              <p className="truncate font-medium">{r.title}</p>
              {r.subtitle && <p className="truncate text-sm text-muted-foreground">{r.subtitle}</p>}
            </div>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{LABEL[r.entity]}</span>
          </div>
        );
        return (
          <li key={`${r.entity}:${r.id}`}>
            {href ? <Link href={href}>{inner}</Link> : inner}
          </li>
        );
      })}
    </ul>
  );
}
