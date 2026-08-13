"use client";

/**
 * Reservation quick-view drawer — the HIMS-style drill-in. Open a booking from
 * the board and see Overview / Charges / Timeline in a right-side sheet without
 * leaving the list; a link jumps to the full page. Fetches on open via the scoped
 * detail action.
 */
import { useEffect, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, BedDouble, CalendarDays, User, Check } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatINR, formatDayMonth, cn } from "@/lib/utils";
import { getReservationDetail, type ReservationDetail } from "../detail-action";

const SOURCE_LABEL: Record<string, string> = {
  WALK_IN: "Walk-in", DIRECT: "Direct", WEBSITE: "Website", PHONE: "Phone", CORPORATE: "Corporate",
  TRAVEL_AGENT: "Travel agent", BOOKING_COM: "Booking.com", MAKEMYTRIP: "MakeMyTrip", GOIBIBO: "Goibibo", AGODA: "Agoda", AIRBNB: "Airbnb",
};
const STATUS_VARIANT: Record<string, "secondary" | "warning" | "success" | "default" | "destructive"> = {
  ENQUIRY: "secondary", CONFIRMED: "warning", IN_HOUSE: "success", CHECKED_OUT: "default", CANCELLED: "destructive", NO_SHOW: "destructive",
};
const LIFECYCLE = ["ENQUIRY", "CONFIRMED", "IN_HOUSE", "CHECKED_OUT"];

export function ReservationDrawer({ openId, onClose }: { openId: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<ReservationDetail | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!openId) { setDetail(null); return; }
    setDetail(null);
    start(async () => setDetail(await getReservationDetail(openId)));
  }, [openId]);

  const d = detail;
  const stepIdx = d ? LIFECYCLE.indexOf(d.status) : -1;
  const terminal = d?.status === "CANCELLED" || d?.status === "NO_SHOW";

  return (
    <Sheet open={!!openId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        {!d ? (
          <div className="p-6 text-sm text-muted-foreground">{pending ? "Loading…" : "Not found."}</div>
        ) : (
          <>
            <div className="border-b p-5">
              <SheetTitle className="text-lg">{d.guestName}</SheetTitle>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span className="font-mono text-xs">{d.code}</span>
                <Badge variant={STATUS_VARIANT[d.status] ?? "secondary"}>{d.status.replace("_", "-").toLowerCase()}</Badge>
                {d.needsAttention ? <Badge variant="destructive">{d.needsAttention}</Badge> : null}
              </div>
            </div>

            <Tabs defaultValue="overview" className="flex-1">
              <TabsList className="mx-5 mt-4">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="charges">Charges</TabsTrigger>
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-3 p-5">
                <Row icon={<CalendarDays className="size-4" />} label="Stay" value={`${formatDayMonth(d.checkInDate)} → ${formatDayMonth(d.checkOutDate)} · ${d.nights}n`} />
                <Row icon={<BedDouble className="size-4" />} label="Rooms" value={d.roomNumbers.length ? d.roomNumbers.join(", ") : "Not assigned"} />
                <Row icon={<User className="size-4" />} label="Guests" value={`${d.adults} adult${d.adults === 1 ? "" : "s"}${d.children ? ` · ${d.children} child` : ""}`} />
                <Row icon={<ArrowRight className="size-4" />} label="Source" value={SOURCE_LABEL[d.source] ?? d.source} />
                <div className="flex items-center justify-between border-t pt-3">
                  <span className="text-sm text-muted-foreground">Balance due</span>
                  <span className={cn("font-semibold tabular", (d.balancePaise ?? 0) > 0 ? "text-destructive" : "text-success")}>
                    {d.balancePaise == null ? "—" : formatINR(d.balancePaise)}
                  </span>
                </div>
              </TabsContent>

              <TabsContent value="charges" className="p-5">
                {d.lines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No charges posted yet.</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {d.lines.map((l, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="min-w-0 truncate">{l.description} <span className="text-xs text-muted-foreground">· {l.type}</span></span>
                        <span className="shrink-0 tabular">{formatINR(l.amountPaise + l.taxPaise)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {d.payments.length > 0 && (
                  <div className="mt-3">
                    <p className="eyebrow mb-1.5">Payments</p>
                    <ul className="space-y-1 text-sm">
                      {d.payments.map((p, i) => (
                        <li key={i} className="flex justify-between"><span className="text-muted-foreground">{p.isRefund ? "Refund" : "Paid"} · {p.mode}</span><span className="tabular">{formatINR(p.amountPaise)}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="timeline" className="p-5">
                {terminal ? (
                  <p className="text-sm">This booking is <span className="font-medium">{d.status.replace("_", "-").toLowerCase()}</span>.</p>
                ) : (
                  <ol className="space-y-0">
                    {LIFECYCLE.map((s, i) => {
                      const done = i <= stepIdx;
                      const current = i === stepIdx;
                      return (
                        <li key={s} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <span className={cn("grid size-6 place-items-center rounded-full text-xs", done ? "bg-primary text-primary-foreground" : "border bg-muted text-muted-foreground")}>
                              {done ? <Check className="size-3.5" /> : i + 1}
                            </span>
                            {i < LIFECYCLE.length - 1 && <span className={cn("h-8 w-px", i < stepIdx ? "bg-primary" : "bg-border")} />}
                          </div>
                          <span className={cn("pt-0.5 text-sm", current ? "font-semibold" : done ? "" : "text-muted-foreground")}>
                            {s.replace("_", "-").toLowerCase()}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </TabsContent>
            </Tabs>

            <div className="mt-auto flex gap-2 border-t p-4">
              <Button asChild variant="outline" className="flex-1"><Link href={`/guests/${d.guestId}`}>Guest profile</Link></Button>
              <Button asChild className="flex-1"><Link href={`/bookings/${d.id}`}>Open full page</Link></Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-muted-foreground">{icon}</span>
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 font-medium">{value}</span>
    </div>
  );
}
