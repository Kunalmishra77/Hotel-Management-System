import { cn } from "@/lib/utils";
import { propertyColor } from "@/lib/property-colors";

/**
 * Property label (client req #11): a small colour dot + plain name — NOT a coloured
 * pill. The property's colour identity now lives on the row/cell background (see
 * `propertyColor().row`); this keeps just a subtle dot marker beside the name.
 */
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
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", className)}>
      <span className={cn("size-1.5 shrink-0 rounded-full", c.dot)} aria-hidden="true" />
      <span className="truncate">{name}</span>
      {count != null ? <span className="tabular opacity-70">· {count}</span> : null}
    </span>
  );
}
