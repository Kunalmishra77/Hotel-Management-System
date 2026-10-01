/**
 * Generic report table (Phase-3 Reports depth). A report is a set of typed columns
 * + rows; this renders them consistently (money right-aligned as ₹, percent as %,
 * an optional bold totals row). Server-rendered. Paired with ExportTableButton for
 * the same columns/rows → CSV. New report types just supply columns + rows.
 */
import { formatINR } from "@/lib/utils";
import { PropertyBadge } from "@/components/ui/property-badge";

export type ReportColumn = {
  key: string;
  label: string;
  /** Format the cell: money → ₹, percent → whole %, property → colour badge, else text. */
  format?: "money" | "percent" | "text" | "property";
  align?: "left" | "right";
};
export type ReportRow = Record<string, string | number>;

function fmt(v: string | number | undefined, format?: ReportColumn["format"]): string {
  if (v === undefined || v === null || v === "") return "—";
  if (format === "money") return formatINR(Number(v));
  if (format === "percent") return `${Math.round(Number(v))}%`;
  return String(v);
}

export function ReportTable({
  columns,
  rows,
  totalsRow,
  emptyLabel = "No data for this range.",
}: {
  columns: ReportColumn[];
  rows: ReportRow[];
  totalsRow?: ReportRow;
  emptyLabel?: string;
}) {
  if (rows.length === 0) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  const align = (c: ReportColumn) => (c.align ?? (c.format === "money" || c.format === "percent" ? "right" : "left"));
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            {columns.map((c) => (
              <th key={c.key} className={`py-2 px-3 font-medium ${align(c) === "right" ? "text-right" : ""}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r[columns[0]!.key] ?? i)} className="border-b last:border-0 hover:bg-muted/30">
              {columns.map((c) => (
                <td key={c.key} className={`py-2.5 px-3 ${align(c) === "right" ? "text-right tabular" : ""} ${c.key === columns[0]!.key ? "font-medium" : "text-muted-foreground"}`}>
                  {c.format === "property" && r[c.key] && String(r[c.key]) !== "All properties"
                    ? <PropertyBadge name={String(r[c.key])} />
                    : fmt(r[c.key], c.format)}
                </td>
              ))}
            </tr>
          ))}
          {totalsRow ? (
            <tr className="border-t-2 bg-muted/30 font-semibold">
              {columns.map((c) => (
                <td key={c.key} className={`py-2.5 px-3 ${align(c) === "right" ? "text-right tabular" : ""}`}>{fmt(totalsRow[c.key], c.format)}</td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
