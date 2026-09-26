import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDayMonth } from "@/lib/utils";
import type { GuestStay } from "../queries";

const STATUS_TONE: Record<string, string> = {
  ENQUIRY: "bg-muted text-muted-foreground",
  CONFIRMED: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  IN_HOUSE: "bg-success/10 text-success",
  CHECKED_OUT: "bg-primary/10 text-primary",
  CANCELLED: "bg-destructive/12 text-destructive",
  NO_SHOW: "bg-destructive/12 text-destructive",
};

/** The guest's stay history across all properties (client req #10). */
export function GuestStaysCard({ stays }: { stays: GuestStay[] }) {
  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary">
          <CalendarClock /> Stays <span className="text-sm font-normal text-muted-foreground">({stays.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {stays.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stays on record yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Booking</th>
                  <th className="py-2 px-3 font-medium">Property</th>
                  <th className="py-2 px-3 font-medium">Dates</th>
                  <th className="py-2 px-3 font-medium">Room</th>
                  <th className="py-2 px-3 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {stays.map((s) => (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="py-2.5 pr-3"><Link href={`/bookings/${s.id}`} className="font-mono text-xs font-medium text-primary hover:underline">{s.code}</Link></td>
                    <td className="py-2.5 px-3 text-muted-foreground">{s.propertyName}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">{formatDayMonth(s.checkInDate)} → {formatDayMonth(s.checkOutDate)} <span className="text-muted-foreground">· {s.nights}n</span></td>
                    <td className="py-2.5 px-3 font-mono text-xs">{s.roomNumbers.join(", ") || "—"}</td>
                    <td className="py-2.5 px-3 text-right">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[s.status] ?? "bg-muted text-muted-foreground"}`}>{s.status.replace(/_/g, " ")}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
