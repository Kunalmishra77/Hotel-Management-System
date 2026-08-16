"use client";
/**
 * DataTable — the enterprise list primitive shared across every portal. A server
 * page fetches rows and hands them here for the interactive layer: column sort,
 * client search, pagination, row hover + click-through, and a graceful empty
 * state. Columns are declarative so each screen only describes its data, never
 * re-implements a table. Responsive: low-priority columns drop on small screens.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, ChevronsUpDown, ChevronLeft, ChevronRight, Search, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "./input";

export type Column<T> = {
  /** Stable id; also the sort key. */
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  /** Provide to make the column sortable. Return a comparable primitive. */
  sortValue?: (row: T) => string | number;
  align?: "left" | "right" | "center";
  className?: string;
  /** Hide this column below the given breakpoint (keeps the table calm on phones). */
  hideBelow?: "sm" | "md" | "lg" | "xl";
};

type SortState = { key: string; dir: "asc" | "desc" } | null;

const HIDE_CLASS: Record<NonNullable<Column<unknown>["hideBelow"]>, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};
const ALIGN: Record<NonNullable<Column<unknown>["align"]>, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  getRowHref,
  searchable,
  initialSort,
  toolbar,
  empty,
  pageSize,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  getRowHref?: (row: T) => string;
  searchable?: { placeholder?: string; accessor: (row: T) => string };
  initialSort?: { key: string; dir: "asc" | "desc" };
  toolbar?: React.ReactNode;
  empty?: React.ReactNode;
  pageSize?: number;
  className?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<SortState>(initialSort ?? null);
  const [page, setPage] = React.useState(0);

  const colByKey = React.useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);

  const filtered = React.useMemo(() => {
    if (!searchable || !query.trim()) return rows;
    const q = query.trim().toLowerCase();
    return rows.filter((r) => searchable.accessor(r).toLowerCase().includes(q));
  }, [rows, query, searchable]);

  const sorted = React.useMemo(() => {
    if (!sort) return filtered;
    const col = colByKey.get(sort.key);
    if (!col?.sortValue) return filtered;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [filtered, sort, colByKey]);

  const pageCount = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const clampedPage = Math.min(page, pageCount - 1);
  const paged = pageSize ? sorted.slice(clampedPage * pageSize, clampedPage * pageSize + pageSize) : sorted;

  React.useEffect(() => setPage(0), [query, sort]);

  const toggleSort = (col: Column<T>) => {
    if (!col.sortValue) return;
    setSort((s) =>
      s?.key === col.key ? { key: col.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: col.key, dir: "asc" },
    );
  };

  return (
    <div className={cn("rounded-xl border bg-card shadow-sm", className)}>
      {(searchable || toolbar) && (
        <div className="flex flex-col gap-3 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
          {searchable ? (
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchable.placeholder ?? "Search…"}
                className="pl-9"
                inputMode="search"
              />
            </div>
          ) : (
            <span />
          )}
          {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}
        </div>
      )}

      {paged.length === 0 ? (
        <div className="p-12 text-center">
          {empty ?? (
            <div className="text-muted-foreground">
              <Inbox className="mx-auto size-6" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-foreground">Nothing to show</p>
              <p className="mt-1 text-sm">{query ? "No rows match your search." : "Rows will appear here."}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                {columns.map((col) => {
                  const active = sort?.key === col.key;
                  const SortIcon = !col.sortValue ? null : active ? (sort!.dir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
                  return (
                    <th
                      key={col.key}
                      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                      className={cn(
                        "whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                        ALIGN[col.align ?? "left"],
                        col.hideBelow && HIDE_CLASS[col.hideBelow],
                      )}
                    >
                      {col.sortValue ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(col)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                            col.align === "right" && "flex-row-reverse",
                            active && "text-foreground",
                          )}
                        >
                          {col.header}
                          {SortIcon ? <SortIcon className="size-3.5" aria-hidden="true" /> : null}
                        </button>
                      ) : (
                        col.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {paged.map((row) => {
                const href = getRowHref?.(row);
                const go = href
                  ? {
                      onClick: () => router.push(href),
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === "Enter") router.push(href);
                      },
                      tabIndex: 0,
                      role: "link" as const,
                    }
                  : {};
                return (
                  <tr
                    key={getRowKey(row)}
                    {...go}
                    className={cn(
                      "border-b last:border-0 transition-colors",
                      href && "u-row cursor-pointer focus-visible:outline-none focus-visible:bg-muted/60",
                    )}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          "px-4 py-3 align-middle",
                          ALIGN[col.align ?? "left"],
                          col.hideBelow && HIDE_CLASS[col.hideBelow],
                          col.className,
                        )}
                      >
                        {col.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pageSize && sorted.length > pageSize && (
        <div className="flex items-center justify-between border-t px-4 py-2.5 text-sm text-muted-foreground">
          <span className="tabular">
            {clampedPage * pageSize + 1}–{Math.min((clampedPage + 1) * pageSize, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={clampedPage === 0}
              className="inline-flex size-8 items-center justify-center rounded-md border transition hover:bg-muted disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </button>
            <span className="px-1 tabular">{clampedPage + 1}/{pageCount}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={clampedPage >= pageCount - 1}
              className="inline-flex size-8 items-center justify-center rounded-md border transition hover:bg-muted disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
