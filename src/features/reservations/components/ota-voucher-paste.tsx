"use client";

/**
 * New booking → "Paste OTA voucher" (client, 24 Nov 2026). Reception pastes the
 * MakeMyTrip / Goibibo voucher (PDF text or the booking email) and the booking form
 * fills itself: channel, OTA booking id, guest, dates, guests, rate before GST and
 * "Already paid online". Reading is local and pure (`parseOtaVoucher`); nothing is
 * saved until the booking is confirmed as usual.
 */
import { useState } from "react";
import { ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/utils";
import { parseOtaVoucher, type OtaVoucher } from "../domain/ota-voucher";

const LABEL: Record<OtaVoucher["source"], string> = { MAKEMYTRIP: "MakeMyTrip", GOIBIBO: "Goibibo" };
const P = { showPaise: true };
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

export function OtaVoucherPaste({ onApply }: { onApply: (v: OtaVoucher) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<OtaVoucher | null>(null);

  const readVoucher = () => {
    const r = parseOtaVoucher(text);
    if (!r.ok) { setError(r.reason); setRead(null); return; }
    setError(null);
    setRead(r.voucher);
    onApply(r.voucher);
  };

  return (
    <Card data-testid="ota-voucher">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary"><ClipboardPaste /> Online booking? Paste the voucher</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!open ? (
          <Button type="button" variant="outline" onClick={() => setOpen(true)} data-testid="ota-voucher-open">Paste MakeMyTrip / Goibibo voucher</Button>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Open the voucher PDF or the booking email, select all (Ctrl+A), copy and paste it here. The form below fills in — check it, pick the room and the guest, then confirm.</p>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="Paste the whole voucher or booking email…" data-testid="ota-voucher-text" />
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={readVoucher} disabled={!text.trim()} data-testid="ota-voucher-read">Fill the booking</Button>
              <Button type="button" variant="ghost" onClick={() => { setOpen(false); setText(""); setError(null); }}>Close</Button>
            </div>
          </>
        )}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {read ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border bg-muted/40 p-3 text-sm" data-testid="ota-voucher-summary">
            <dt className="text-muted-foreground">{LABEL[read.source]} ID</dt><dd className="font-mono">{read.channelRef}{read.pnr ? ` · PNR ${read.pnr}` : ""}</dd>
            <dt className="text-muted-foreground">Guest</dt><dd>{read.guestName ?? "— not on the voucher"}</dd>
            <dt className="text-muted-foreground">Stay</dt><dd>{day(read.checkInDate)} → {day(read.checkOutDate)} · {read.nights} night{read.nights > 1 ? "s" : ""} · {read.adults} adult{read.adults > 1 ? "s" : ""}{read.children ? ` + ${read.children} child` : ""}</dd>
            <dt className="text-muted-foreground">Rate / night</dt><dd>{formatINR(read.ratePaise, P)} + GST</dd>
            <dt className="text-muted-foreground">Voucher total</dt><dd>{formatINR(read.grossPaise, P)} ({read.prepaid ? "paid online" : "guest pays at the hotel"})</dd>
            {read.payablePaise !== null ? (<><dt className="text-muted-foreground">{LABEL[read.source]} pays you</dt><dd>{formatINR(read.payablePaise, P)}</dd></>) : null}
          </dl>
        ) : null}
      </CardContent>
    </Card>
  );
}
