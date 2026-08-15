"use client";
/** Register a new asset (architecture v2 · Phase 5). */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createAsset } from "../actions";
import { ASSET_CATEGORIES } from "../schema";

export function AssetForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>(ASSET_CATEGORIES[0]);
  const [location, setLocation] = useState("");
  const [warrantyUntil, setWarrantyUntil] = useState("");

  function submit() {
    setError(null);
    start(async () => {
      const res = await createAsset({
        name,
        category,
        location: location.trim() || undefined,
        warrantyUntil: warrantyUntil.trim() || undefined,
      });
      if (!res.ok) return setError(res.error.message);
      setName(""); setLocation(""); setWarrantyUntil(""); setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} size="sm"><Plus className="size-4" /> Register asset</Button>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lobby AC unit" maxLength={120} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="min-h-touch w-full rounded-md border bg-background px-3 text-sm">
            {ASSET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Location (optional)</span>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Room / area" maxLength={80} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Warranty until (optional)</span>
          <Input type="date" value={warrantyUntil} onChange={(e) => setWarrantyUntil(e.target.value)} />
        </label>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={submit} disabled={pending || !name.trim()}>{pending ? "Saving…" : "Save asset"}</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
      </div>
    </div>
  );
}
