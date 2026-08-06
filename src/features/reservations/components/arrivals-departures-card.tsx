import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDayMonth } from "@/lib/utils";
import type { ReservationListItem } from "../queries";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning"> = {
  CONFIRMED: "warning",
  IN_HOUSE: "success",
  ENQUIRY: "secondary",
};

/**
 * Compact arrivals / departures list for the reception dashboard — read-only,
 * each row links to the booking. Actions live on the Bookings board.
 */
export function ArrivalsDeparturesCard({
  title,
  icon,
  emptyLabel,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  emptyLabel: string;
  items: ReservationListItem[];
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary">
          {icon}
          {title}
        </CardTitle>
        <Badge variant="secondary" className="tabular">
          {items.length}
        </Badge>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ul className="-mx-2">
            {items.map((it) => (
              <li key={it.id}>
                <Link
                  href={`/bookings/${it.id}`}
                  className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{it.guestName}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {it.roomNumbers.length ? it.roomNumbers.join(", ") : "Unassigned"} · {it.nights}n ·{" "}
                      {formatDayMonth(it.checkInDate)}–{formatDayMonth(it.checkOutDate)}
                    </p>
                  </div>
                  <Badge variant={STATUS_VARIANT[it.status] ?? "secondary"}>
                    {it.needsAttention ? "Needs attention" : it.status.replace("_", "-").toLowerCase()}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
