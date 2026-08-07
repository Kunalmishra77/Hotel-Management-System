"use client";

/**
 * Reports filter — month + property-set. Drives the report via URL params so the
 * server component re-fetches (shareable/bookmarkable). Managers with one property
 * see only the month picker.
 */
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";

export type PropertyOption = { id: string; name: string; code: string };

export function ReportsFilterBar({
  properties,
  selected,
  month,
}: {
  properties: PropertyOption[];
  selected: string[];
  month: string;
}) {
  const router = useRouter();
  const allSelected = selected.length >= properties.length;

  const go = (nextMonth: string, nextProps: string[]) => {
    const params = new URLSearchParams();
    params.set("month", nextMonth);
    // Only pin properties when it's a real subset — otherwise default to "all".
    if (nextProps.length > 0 && nextProps.length < properties.length) {
      params.set("properties", nextProps.join(","));
    }
    router.push(`/reports?${params.toString()}`);
  };

  const toggle = (id: string) => {
    const set = new Set(allSelected ? [id] : selected);
    if (allSelected) {
      // From "all", a chip click narrows to just that property.
      go(month, [id]);
      return;
    }
    if (set.has(id)) set.delete(id);
    else set.add(id);
    const next = [...set];
    if (next.length === 0) return; // keep at least one
    go(month, next);
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="reports-filter">
      <Input
        type="month"
        defaultValue={month}
        onChange={(e) => e.target.value && go(e.target.value, selected)}
        className="w-40"
        aria-label="Month"
        data-testid="report-month"
      />
      {properties.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          <Chip active={allSelected} onClick={() => go(month, properties.map((p) => p.id))}>
            All
          </Chip>
          {properties.map((p) => (
            <Chip key={p.id} active={!allSelected && selected.includes(p.id)} onClick={() => toggle(p.id)}>
              {p.code}
            </Chip>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-touch rounded-full border px-3 text-sm transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
