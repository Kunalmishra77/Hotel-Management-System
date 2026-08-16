"use client";
/** White-label branding form (architecture v2 · SaaS). */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setBranding } from "../actions";

export function BrandingForm({ brandName, brandColor }: { brandName: string; brandColor: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(brandName);
  const [color, setColor] = useState(brandColor ?? "#1F5C46");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null); setMsg(null);
    start(async () => {
      const res = await setBranding({ brandName: name.trim() || undefined, brandColor: color });
      if (!res.ok) return setError(res.error.message);
      setMsg("Branding saved.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="brandName">Brand name</Label>
        <Input id="brandName" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your brand" maxLength={60} />
        <p className="text-xs text-muted-foreground">Shown across your team&apos;s app. Leave blank to use your company name.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="brandColor">Accent colour</Label>
        <div className="flex items-center gap-3">
          <input id="brandColor" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="size-10 cursor-pointer rounded-md border bg-background" aria-label="Accent colour" />
          <span className="font-mono text-sm text-muted-foreground">{color}</span>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {msg && <p className="text-sm text-emerald-600">{msg}</p>}
      <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Save branding"}</Button>
    </div>
  );
}
