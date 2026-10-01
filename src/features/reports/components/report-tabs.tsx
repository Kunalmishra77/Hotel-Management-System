/**
 * Report-type selector (Phase-3 Reports depth). Links that switch the report while
 * preserving the month + property filters in the query string. Server-rendered.
 */
import Link from "next/link";
import { cn } from "@/lib/utils";

export const REPORT_TYPES = [
  { key: "profit", label: "Profit & loss" },
  { key: "occupancy", label: "Occupancy & rate" },
  { key: "bookings", label: "Bookings" },
  { key: "rooms", label: "Rooms" },
  { key: "source", label: "Revenue by source" },
  { key: "gst", label: "GST summary" },
  { key: "dues", label: "Outstanding dues" },
] as const;

export type ReportType = (typeof REPORT_TYPES)[number]["key"];

export function ReportTabs({ active, month, properties }: { active: ReportType; month: string; properties: string }) {
  const q = (type: string) => {
    const parts = [`report=${type}`, month ? `month=${month}` : "", properties ? `properties=${properties}` : ""].filter(Boolean);
    return `/reports?${parts.join("&")}`;
  };
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border bg-card p-1" role="tablist" aria-label="Report type">
      {REPORT_TYPES.map((t) => (
        <Link
          key={t.key}
          href={q(t.key)}
          data-testid={`report-tab-${t.key}`}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            active === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
