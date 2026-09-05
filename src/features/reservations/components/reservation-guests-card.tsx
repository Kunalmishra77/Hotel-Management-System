"use client";

/**
 * Occupancy + accompanying-guests panel on the booking detail (03 add-ons).
 * Extra people who arrive at/after check-in are added to THIS booking — no new
 * booking. Occupancy counts are editable on an active stay. All writes go through
 * the property-scoped, audited server actions; the page re-renders on success.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, X, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { addReservationGuest, removeReservationGuest, updateReservationOccupancy } from "../guest-actions";

type Guest = { id: string; fullName: string; age: number | null; gender: string | null; relation: string | null };

const ACTIVE = new Set(["ENQUIRY", "CONFIRMED", "IN_HOUSE"]);

export function ReservationGuestsCard({
  reservationId,
  status,
  adults,
  childCount,
  guests,
  canManage,
}: {
  reservationId: string;
  status: string;
  adults: number;
  childCount: number;
  guests: Guest[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editOcc, setEditOcc] = useState(false);
  const [adForm, setAdForm] = useState({ fullName: "", age: "", gender: "", relation: "" });
  const editable = canManage && ACTIVE.has(status);

  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, after?: () => void) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) { setError(res.error?.message ?? "Something went wrong."); return; }
      after?.();
      router.refresh();
    });
  };

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary">
          <Users /> Occupancy &amp; guests
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {/* Occupancy */}
        {!editOcc ? (
          <div className="flex items-center justify-between">
            <p>
              <span className="text-muted-foreground">Occupancy:</span> {adults} adult(s) · {childCount} child(ren)
            </p>
            {editable && (
              <Button variant="outline" size="sm" onClick={() => setEditOcc(true)}>Edit</Button>
            )}
          </div>
        ) : (
          <form
            className="flex flex-wrap items-end gap-3"
            action={(fd) =>
              run(
                () =>
                  updateReservationOccupancy({
                    reservationId,
                    adults: Number(fd.get("adults")),
                    children: Number(fd.get("children")),
                  }),
                () => setEditOcc(false),
              )
            }
          >
            <div className="space-y-1">
              <Label htmlFor="adults">Adults</Label>
              <Input id="adults" name="adults" type="number" min={1} max={30} defaultValue={adults} className="w-24" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="children">Children</Label>
              <Input id="children" name="children" type="number" min={0} max={30} defaultValue={childCount} className="w-24" />
            </div>
            <Button type="submit" size="sm" disabled={pending}>Save</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditOcc(false)}>Cancel</Button>
          </form>
        )}

        {/* Accompanying guests */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Accompanying guests</p>
          {guests.length === 0 ? (
            <p className="text-muted-foreground">No accompanying guests recorded.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {guests.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-2 p-2.5">
                  <span>
                    <span className="font-medium">{g.fullName}</span>
                    <span className="text-muted-foreground">
                      {[g.age != null ? `${g.age}y` : null, g.gender, g.relation].filter(Boolean).length > 0
                        ? ` · ${[g.age != null ? `${g.age}y` : null, g.gender, g.relation].filter(Boolean).join(" · ")}`
                        : ""}
                    </span>
                  </span>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={pending}
                      onClick={() => run(() => removeReservationGuest({ reservationGuestId: g.id }))}
                      aria-label={`Remove ${g.fullName}`}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Add a guest */}
        {editable && (
          <form
            className="grid gap-3 rounded-md border border-dashed p-3 sm:grid-cols-2"
            action={(fd) =>
              run(
                () =>
                  addReservationGuest({
                    reservationId,
                    fullName: String(fd.get("fullName") ?? ""),
                    age: fd.get("age") ? Number(fd.get("age")) : null,
                    gender: String(fd.get("gender") ?? ""),
                    relation: String(fd.get("relation") ?? ""),
                  }),
                () => setAdForm({ fullName: "", age: "", gender: "", relation: "" }),
              )
            }
          >
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="ag-name">Add a guest to this booking</Label>
              <Input id="ag-name" name="fullName" required placeholder="Full name"
                value={adForm.fullName} onChange={(e) => setAdForm((s) => ({ ...s, fullName: e.target.value }))} />
            </div>
            <Input name="age" type="number" min={0} max={120} placeholder="Age"
              value={adForm.age} onChange={(e) => setAdForm((s) => ({ ...s, age: e.target.value }))} />
            <Input name="gender" placeholder="Gender"
              value={adForm.gender} onChange={(e) => setAdForm((s) => ({ ...s, gender: e.target.value }))} />
            <Input name="relation" placeholder="Relation (e.g. Spouse)" className="sm:col-span-2"
              value={adForm.relation} onChange={(e) => setAdForm((s) => ({ ...s, relation: e.target.value }))} />
            <Button type="submit" size="sm" disabled={pending || !adForm.fullName.trim()} className="sm:col-span-2 sm:justify-self-start">
              <UserPlus className="size-4" /> Add guest
            </Button>
          </form>
        )}

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
