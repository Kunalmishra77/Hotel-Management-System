/**
 * Reservation calendar — a room × date tape chart (the classic PMS view). Each
 * row is a room; each column a property-local day; a coloured cell is an
 * allocation (status-coded) that links to its booking. Server-rendered; the page
 * drives the visible window via prev/next/today links. Horizontally scrollable so
 * it holds on a phone.
 */
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { CalendarAllocation } from "../queries";

type CalRoom = { id: string; number: string; categoryName: string };

const STATUS_CELL: Record<string, string> = {
  ENQUIRY: "bg-muted text-foreground",
  CONFIRMED: "bg-warning/25 text-warning-foreground",
  IN_HOUSE: "bg-success/25 text-success-foreground",
  CHECKED_OUT: "bg-primary/10 text-foreground",
};
const cellTone = (status: string) => STATUS_CELL[status] ?? "bg-primary/10 text-foreground";

const dayKey = (d: Date) => d.getTime();
const covers = (a: CalendarAllocation, dayTime: number) =>
  a.startDate.getTime() <= dayTime && dayTime < a.endDate.getTime();

export function ReservationCalendar({
  rooms,
  allocations,
  days,
  todayTime,
}: {
  rooms: CalRoom[];
  allocations: CalendarAllocation[];
  days: Date[];
  todayTime: number;
}) {
  const byRoom = new Map<string, CalendarAllocation[]>();
  for (const a of allocations) {
    const list = byRoom.get(a.roomId) ?? [];
    list.push(a);
    byRoom.set(a.roomId, list);
  }

  return (
    <div className="overflow-x-auto rounded-lg border" data-testid="reservation-calendar">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted/40">
            <th className="sticky left-0 z-10 min-w-[7rem] border-b border-r bg-muted/40 px-3 py-2 text-left font-medium">Room</th>
            {days.map((d) => {
              const isToday = dayKey(d) === todayTime;
              return (
                <th
                  key={dayKey(d)}
                  className={cn("min-w-[3.25rem] border-b border-l px-1 py-1.5 text-center text-xs font-medium", isToday && "bg-primary/10 text-primary")}
                >
                  <div className="text-muted-foreground">{d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" })}</div>
                  <div className="tabular">{d.toLocaleDateString("en-IN", { day: "2-digit", timeZone: "UTC" })}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rooms.map((room) => {
            const allocs = byRoom.get(room.id) ?? [];
            return (
              <tr key={room.id} className="odd:bg-card even:bg-muted/20">
                <th className="sticky left-0 z-10 border-r bg-inherit px-3 py-1.5 text-left font-medium">
                  <span className="tabular">{room.number}</span>
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">{room.categoryName}</span>
                </th>
                {days.map((d, i) => {
                  const t = dayKey(d);
                  const a = allocs.find((x) => covers(x, t));
                  if (!a) {
                    return <td key={t} className={cn("border-l", t === todayTime && "bg-primary/5")} />;
                  }
                  // Label only on the span's first visible day, so a multi-night
                  // stay reads as one bar rather than a repeated name.
                  const prevDay = i > 0 ? days[i - 1] : undefined;
                  const prevCovered = prevDay !== undefined && covers(a, dayKey(prevDay));
                  return (
                    <td key={t} className="border-l p-0">
                      <Link
                        href={`/bookings/${a.reservationId}`}
                        title={`${a.guestName} · ${a.code} · ${a.status}`}
                        className={cn("flex h-9 items-center overflow-hidden px-1.5 text-xs font-medium", cellTone(a.status))}
                      >
                        {!prevCovered ? <span className="truncate">{a.guestName}</span> : null}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
