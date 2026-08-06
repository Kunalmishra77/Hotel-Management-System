import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Breadcrumb trail — orients the user inside a deep portal. */
export function Breadcrumb({
  items,
  className,
}: {
  items: { label: string; href?: string }[];
  className?: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className={cn("flex items-center text-sm text-muted-foreground", className)}>
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
              {item.href && !last ? (
                <a href={item.href} className="transition-colors hover:text-foreground">
                  {item.label}
                </a>
              ) : (
                <span className={cn(last && "font-medium text-foreground")} aria-current={last ? "page" : undefined}>
                  {item.label}
                </span>
              )}
              {!last ? <ChevronRight className="size-3.5 opacity-60" aria-hidden /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
