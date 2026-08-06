import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Empty state — an invitation to act, never a dead end (ui-foundation.md).
 * Always give a next step: a primary action or a hint about what will appear.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed bg-card/50 px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <span className="mb-3 grid size-12 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-6">
          {icon}
        </span>
      ) : null}
      <p className="font-display text-base font-semibold">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
