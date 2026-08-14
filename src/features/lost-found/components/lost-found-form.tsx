"use client";
/** Log a found item (Phase 7). */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { logLostItem } from "../actions";

export function LostFoundForm() {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [description, setDescription] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [foundOn, setFoundOn] = useState(today);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await logLostItem({ description, roomNumber: roomNumber || undefined, foundOn, notes: notes || undefined });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setDescription("");
      setRoomNumber("");
      setNotes("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="lf-desc">Item</Label>
        <Input id="lf-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Black phone charger" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="lf-room">Room (optional)</Label>
          <Input id="lf-room" value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} placeholder="204" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lf-date">Found on</Label>
          <Input id="lf-date" type="date" value={foundOn} max={today} onChange={(e) => setFoundOn(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="lf-notes">Notes (optional)</Label>
        <Textarea id="lf-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={submit} disabled={pending || description.trim().length < 2} block>
        {pending ? "Logging…" : "Log item"}
      </Button>
    </div>
  );
}
