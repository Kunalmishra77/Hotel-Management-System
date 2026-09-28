"use client";

/**
 * Transfer an in-house guest to ANOTHER property mid-stay (e.g. their room is booked
 * from tomorrow but they want to stay on). Pick the destination property, the
 * transfer date and the new check-out, find a free room there, and confirm. The
 * origin is checked out on the transfer date and a linked stay is created at the new
 * property — each billed on its own folio (combined statement at checkout).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { searchAvailability } from "../availability-action";
import { transferToProperty } from "../transfer-actions";
import type { AvailableRoom } from "../availability";

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;
const toPaise = (r: number) => Math.round(r * 100);

export function TransferPropertyCard({
  reservationId,
  currentPropertyId,
  checkOutDate,
  properties,
}: {
  reservationId: string;
  currentPropertyId: string;
  checkOutDate: string; // ISO yyyy-mm-dd — the current check-out
  properties: { id: string; name: string }[];
}) {
  const router = useRouter();
  const others = properties.filter((p) => p.id !== currentPropertyId);
  const [toPropertyId, setToPropertyId] = useState(others[0]?.id ?? "");
  const [transferDate, setTransferDate] = useState(checkOutDate);
  const [newCheckOut, setNewCheckOut] = useState("");
  const [rooms, setRooms] = useState<AvailableRoom[] | null>(null);
  const [toRoomId, setToRoomId] = useState("");
  const [rate, setRate] = useState(0);
  const [searching, startSearch] = useTransition();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const canSearch = toPropertyId && transferDate && newCheckOut && newCheckOut > transferDate;

  const find = () => {
    setError(null);
    setRooms(null);
    setToRoomId("");
    startSearch(async () => {
      const res = await searchAvailability({ propertyId: toPropertyId, checkInDate: transferDate, checkOutDate: newCheckOut });
      setRooms(res.ok ? res.data.rooms : []);
    });
  };

  const pickRoom = (r: AvailableRoom) => {
    setToRoomId(r.id);
    setRate(r.baseRatePaise / 100);
  };

  const submit = () => {
    setError(null);
    setDone(null);
    start(async () => {
      const res = await transferToProperty({
        reservationId, toPropertyId, toRoomId, transferDate, newCheckOutDate: newCheckOut, ratePaise: toPaise(rate),
      });
      if (!res.ok) { setError(res.error.message); return; }
      setDone(res.data.newCode);
      router.refresh();
    });
  };

  if (others.length === 0) return null;

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary">
          <ArrowRightLeft /> Transfer to another property
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Guest needs to move to a different property (e.g. this room is booked from tomorrow)? Check them out here on the transfer date and continue their stay at another property — each property bills its own nights, and the guest gets one combined bill at checkout.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Destination property</Label>
            <select value={toPropertyId} onChange={(e) => { setToPropertyId(e.target.value); setRooms(null); setToRoomId(""); }}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="transfer-property">
              {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="transfer-date">Transfer date (leaves this property)</Label>
            <Input id="transfer-date" type="date" value={transferDate} onChange={(e) => { setTransferDate(e.target.value); setRooms(null); }} data-testid="transfer-date" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="transfer-checkout">New check-out</Label>
            <Input id="transfer-checkout" type="date" min={transferDate} value={newCheckOut} onChange={(e) => { setNewCheckOut(e.target.value); setRooms(null); }} data-testid="transfer-checkout" />
          </div>
        </div>

        <Button type="button" variant="outline" size="sm" disabled={!canSearch || searching} onClick={find} data-testid="transfer-find-rooms">
          <Building2 className="size-4" /> {searching ? "Finding rooms…" : "Find free rooms"}
        </Button>

        {rooms !== null && (
          rooms.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="transfer-no-rooms">No free rooms at that property for those dates.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Pick a room at the destination:</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {rooms.map((r) => (
                  <li key={r.id}>
                    <Button type="button" block variant={toRoomId === r.id ? "default" : "outline"} size="sm" onClick={() => pickRoom(r)} data-testid={`transfer-room-${r.number}`}>
                      {toRoomId === r.id ? "✓ " : ""}{r.number} · {r.categoryName} · {rupees(r.baseRatePaise)}/night
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )
        )}

        {toRoomId ? (
          <div className="flex flex-wrap items-end gap-3 border-t pt-3">
            <div className="space-y-1.5">
              <Label htmlFor="transfer-rate">Rate / night (₹) at new property</Label>
              <Input id="transfer-rate" type="number" inputMode="decimal" step="0.01" value={rate} onChange={(e) => setRate(Number(e.target.value))} className="w-40" data-testid="transfer-rate" />
            </div>
            <Button type="button" disabled={pending || rate <= 0} onClick={submit} data-testid="transfer-submit">
              {pending ? "Transferring…" : "Transfer guest"}
            </Button>
          </div>
        ) : null}

        {error && <p role="alert" className="text-sm text-destructive" data-testid="transfer-error">{error}</p>}
        {done && (
          <p className="rounded-md border border-emerald-600/30 bg-emerald-500/10 p-2 text-sm text-emerald-700 dark:text-emerald-400" data-testid="transfer-done">
            ✔ Guest transferred. New booking {done} created at the destination property. This booking is now checked out.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
