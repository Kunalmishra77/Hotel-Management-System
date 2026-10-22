"use client";

/**
 * Move a guest to a DIFFERENT ROOM within the SAME property (03, AC-19) — e.g. the
 * guest wants a higher floor, or the current room has an issue. Finds the free rooms
 * at this property for the booking's dates, and on pick re-allocates via
 * `reallocateRoom` (atomic, re-checks availability). The rate is unchanged; edit it
 * separately if the new room's tariff differs. For cross-property moves use the
 * "Transfer"/"Check in at a different property" cards instead.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DoorOpen, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { searchAvailability } from "../availability-action";
import { reallocateRoom } from "../move-actions";
import type { AvailableRoom } from "../availability";

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;

export function MoveRoomCard({
  reservationId,
  propertyId,
  checkInDate,
  checkOutDate,
  currentRoom,
}: {
  reservationId: string;
  propertyId: string;
  checkInDate: string; // ISO yyyy-mm-dd
  checkOutDate: string;
  currentRoom: string | null;
}) {
  const router = useRouter();
  const [rooms, setRooms] = useState<AvailableRoom[] | null>(null);
  const [toRoomId, setToRoomId] = useState("");
  const [searching, startSearch] = useTransition();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const find = () => {
    setError(null);
    setRooms(null);
    setToRoomId("");
    startSearch(async () => {
      const res = await searchAvailability({ propertyId, checkInDate, checkOutDate });
      setRooms(res.ok ? res.data.rooms : []);
    });
  };

  const submit = (roomId: string, number: string) => {
    setError(null);
    setDone(null);
    setToRoomId(roomId);
    start(async () => {
      const res = await reallocateRoom({ reservationId, toRoomId: roomId });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setDone(number);
      router.refresh();
    });
  };

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary">
          <DoorOpen /> Move to another room
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Shift this guest to a different room in {currentRoom ? <>the same property (currently {currentRoom})</> : "this property"} — same dates and rate.
        </p>

        <Button type="button" variant="outline" size="sm" disabled={searching} onClick={find} data-testid="move-room-find">
          <Search className="size-4" /> {searching ? "Finding rooms…" : "Find free rooms"}
        </Button>

        {rooms !== null &&
          (rooms.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="move-room-none">
              No other free rooms at this property for these dates.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Pick the new room:</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {rooms.map((r) => (
                  <li key={r.id}>
                    <Button
                      type="button"
                      block
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => submit(r.id, r.number)}
                      data-testid={`move-room-${r.number}`}
                    >
                      {pending && toRoomId === r.id ? "Moving… " : ""}
                      {r.number} · {r.categoryName} · {rupees(r.baseRatePaise)}/night
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}

        {error && (
          <p role="alert" className="text-sm text-destructive" data-testid="move-room-error">
            {error}
          </p>
        )}
        {done && (
          <p
            className="rounded-md border border-emerald-600/30 bg-emerald-500/10 p-2 text-sm text-emerald-700 dark:text-emerald-400"
            data-testid="move-room-done"
          >
            ✔ Moved to room {done}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
