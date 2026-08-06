import { cn } from "@/lib/utils";

/** Loading placeholder — use to reserve layout while data streams in. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}
