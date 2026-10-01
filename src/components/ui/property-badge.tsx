import { cn } from "@/lib/utils";
import { propertyColor } from "@/lib/property-colors";

/** A light, property-coloured badge (client req #11). Optional trailing count. */
export function PropertyBadge({
  name,
  count,
  className,
}: {
  name: string;
  count?: number;
  className?: string;
}) {
  const c = propertyColor(name);
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", c.badge, className)}>
      <span className={cn("size-1.5 shrink-0 rounded-full", c.dot)} aria-hidden="true" />
      <span className="truncate">{name}</span>
      {count != null ? <span className="tabular opacity-70">· {count}</span> : null}
    </span>
  );
}
