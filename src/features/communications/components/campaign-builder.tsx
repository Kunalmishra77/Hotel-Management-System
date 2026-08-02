"use client";

/**
 * 12 T-22 — marketing campaign builder (AC-12). Pick a template, paste the
 * recipient guest ids (a segment resolves to these in a fuller build), optionally
 * attach a coupon, and launch. The server evaluates consent per recipient and
 * fans out exactly one message per eligible guest — the result shows how many
 * were enqueued vs skipped (opted-out / no address).
 */
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { launchCampaign } from "../actions";

export function CampaignBuilder({ templateKeys, propertyId }: { templateKeys: string[]; propertyId: string | null }) {
  const [templateKey, setTemplateKey] = useState(templateKeys[0] ?? "");
  const [channel, setChannel] = useState("WHATSAPP");
  const [recipients, setRecipients] = useState("");
  const [couponId, setCouponId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onLaunch = () => {
    const recipientGuestIds = recipients.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (recipientGuestIds.length === 0) {
      setMessage("Add at least one recipient guest id.");
      return;
    }
    startTransition(async () => {
      const res = await launchCampaign({ templateKey, channel, recipientGuestIds, couponId: couponId || undefined, propertyId: propertyId ?? undefined });
      setMessage(res.ok ? `Enqueued ${res.data.enqueued}, skipped ${res.data.skipped}.` : res.error.message);
    });
  };

  return (
    <div className="space-y-3 rounded-md border p-4">
      <p className="font-medium">New campaign</p>
      <div className="space-y-1">
        <Label htmlFor="tpl">Template</Label>
        <select id="tpl" className="min-h-11 w-full rounded-md border px-2 text-sm" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
          {templateKeys.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="ch">Channel</Label>
        <select id="ch" className="min-h-11 w-full rounded-md border px-2 text-sm" value={channel} onChange={(e) => setChannel(e.target.value)}>
          {["WHATSAPP", "EMAIL", "SMS"].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="rcpt">Recipient guest ids</Label>
        <Input id="rcpt" value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="guest_a, guest_b" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="coupon">Coupon id (optional)</Label>
        <Input id="coupon" value={couponId} onChange={(e) => setCouponId(e.target.value)} placeholder="coupon_…" />
      </div>
      <Button onClick={onLaunch} disabled={pending || !templateKey} className="w-full">
        {pending ? "Launching…" : "Launch campaign"}
      </Button>
      {message && <p className="text-sm text-muted-foreground" role="status">{message}</p>}
    </div>
  );
}
