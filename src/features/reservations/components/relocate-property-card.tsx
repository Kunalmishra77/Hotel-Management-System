"use client";

/**
 * Relocate a NOT-YET-ARRIVED booking to another property (03). The guest booked
 * this property but, on arrival (or before), wants a different one — since they
 * never stayed here, the whole booking simply MOVES: same dates, same guest, a new
 * room at the destination (optionally a new rate). Any advance already taken moves
 * with the folio. Reception then checks the guest in normally at the new property.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDayMonth } from "@/lib/utils";
import { searchAvailability } from "../availability-action";
import { relocateBeforeCheckIn } from "../transfer-actions";
import type { AvailableRoom } from "../availability";

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;
const toPaise = (r: number) => Math.round(r * 100);

export function RelocatePropertyCard({
  reservationId,
  currentPropertyId,
  checkInDate,
  checkOutDate,
  nights,
  properties,
}: {
  reservationId: string;
  currentPropertyId: string;
  checkInDate: string; // ISO yyyy-mm-dd (unchanged by the move)
  checkOutDate: string; // ISO yyyy-mm-dd
  nights: number;
  properties: { id: string; name: string }[];
}) {
  const router = useRouter();
  const others = properties.filter((p) => p.id !== currentPropertyId);
  const [toPropertyId, setToPropertyId] = useState(others[0]?.id ?? "");
  const [rooms, setRooms] = useState<AvailableRoom[] | null>(null);
  const [toRoomId, setToRoomId] = useState("");
  const [rate, setRate] = useState(0);
  const [searching, startSearch] = useTransition();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const find = () => {
    setError(null);
    setRooms(null);
    setToRoomId("");
    startSearch(async () => {
      const res = await searchAvailability({ propertyId: toPropertyId, checkInDate, checkOutDate });
      setRooms(res.ok ? res.data.rooms : []);
    });
  };

  const pickRoom = (r: AvailableRoom) => {
    setToRoomId(r.id);
    setRate(r.baseRatePaise / 100);
  };

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await relocateBeforeCheckIn({
        reservationId,
        toPropertyId,
        toRoomId,
        ratePaise: rate > 0 ? toPaise(rate) : undefined,
      });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setDone(true);
      router.refresh();
    });
  };

  if (others.length === 0) return null;

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary">
          <ArrowRightLeft /> Check in at a different property
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Guest doesn&apos;t want this property on arrival? Move the whole booking to another property — same dates
          ({formatDayMonth(new Date(checkInDate))} → {formatDayMonth(new Date(checkOutDate))}, {nights} night(s)) and any
          advance already paid come along. Then check the guest in there as usual.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Destination property</Label>
            <select
              value={toPropertyId}
              onChange={(e) => {
                setToPropertyId(e.target.value);
                setRooms(null);
                setToRoomId("");
              }}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              data-testid="relocate-property"
            >
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button type="button" variant="outline" size="sm" disabled={!toPropertyId || searching} onClick={find} data-testid="relocate-find-rooms">
              <Building2 className="size-4" /> {searching ? "Finding rooms…" : "Find free rooms"}
            </Button>
          </div>
        </div>

        {rooms !== null &&
          (rooms.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="relocate-no-rooms">
              No free rooms at that property for these dates.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Pick a room at the destination:</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {rooms.map((r) => (
                  <li key={r.id}>
                    <Button
                      type="button"
                      block
                      variant={toRoomId === r.id ? "default" : "outline"}
                      size="sm"
                      onClick={() => pickRoom(r)}
                      data-testid={`relocate-room-${r.number}`}
                    >
                      {toRoomId === r.id ? "✓ " : ""}
                      {r.number} · {r.categoryName} · {rupees(r.baseRatePaise)}/night
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}

        {toRoomId ? (
          <div className="flex flex-wrap items-end gap-3 border-t pt-3">
            <div className="space-y-1.5">
              <Label htmlFor="relocate-rate">Rate / night (₹) at new property</Label>
              <Input
                id="relocate-rate"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                className="w-40"
                data-testid="relocate-rate"
              />
            </div>
            <Button type="button" disabled={pending || rate <= 0} onClick={submit} data-testid="relocate-submit">
              {pending ? "Moving…" : "Move booking here"}
            </Button>
          </div>
        ) : null}

        {error && (
          <p role="alert" className="text-sm text-destructive" data-testid="relocate-error">
            {error}
          </p>
        )}
        {done && (
          <p
            className="rounded-md border border-emerald-600/30 bg-emerald-500/10 p-2 text-sm text-emerald-700 dark:text-emerald-400"
            data-testid="relocate-done"
          >
            ✔ Booking moved to the new property. Check the guest in there as usual.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
