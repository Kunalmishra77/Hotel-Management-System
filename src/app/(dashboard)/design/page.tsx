"use client";

/**
 * Design system showcase — the living reference for the Woodpecker HMS UI
 * foundation (Operations base · Concierge brand · Nightshift dark). Every token
 * and core component is demonstrated here so pages stay consistent.
 */
import * as React from "react";
import {
  BedDouble,
  CalendarCheck,
  IndianRupee,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { KpiCard } from "@/components/ui/kpi-card";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill, type RoomStatus } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const SWATCHES = [
  ["Primary", "bg-primary text-primary-foreground"],
  ["Pine", "bg-brand-pine text-brand-pine-foreground"],
  ["Brass", "bg-brand-brass text-brand-brass-foreground"],
  ["Success", "bg-success text-success-foreground"],
  ["Warning", "bg-warning text-warning-foreground"],
  ["Destructive", "bg-destructive text-destructive-foreground"],
  ["Muted", "bg-muted text-muted-foreground"],
  ["Accent", "bg-accent text-accent-foreground"],
];
const STATUSES: RoomStatus[] = ["vacant", "occupied", "reserved", "housekeeping", "maintenance"];
const CHART = [42, 55, 48, 63, 58, 71, 82];

function Sparkline({ data }: { data: number[] }) {
  const w = 120;
  const h = 32;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const pts = data
    .map((d, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((d - min) / (max - min || 1)) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-full" preserveAspectRatio="none" aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke="hsl(188 84% 34%)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function DesignPage() {
  const [cmdOpen, setCmdOpen] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <TooltipProvider>
      <Breadcrumb items={[{ label: "Home", href: "/dashboard" }, { label: "Design system" }]} className="mb-3" />
      <PageHeader
        title="Design system"
        description="Operations base · Concierge brand layer · Nightshift dark. The living UI reference."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setCmdOpen(true)}>
              <Search /> Search <kbd className="ml-1 rounded bg-muted px-1.5 text-xs">⌘K</kbd>
            </Button>
            <ThemeToggle />
          </>
        }
      />

      {/* Typography */}
      <Section title="Typography">
        <Card>
          <CardContent className="space-y-3 pt-5">
            <p className="font-serif text-3xl font-semibold">Fraunces — brand display</p>
            <p className="font-display text-2xl font-bold">Space Grotesk — headings &amp; KPIs</p>
            <p className="font-sans text-base">Inter — body text for forms, tables and everything read all day.</p>
            <p className="font-mono text-sm tabular">JetBrains Mono — ₹2,41,600 · DLX-204 · WMG-0007 · 14:00</p>
          </CardContent>
        </Card>
      </Section>

      {/* Colour tokens */}
      <Section title="Colour tokens">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SWATCHES.map(([name, cls]) => (
            <div key={name} className={`flex h-16 items-end rounded-lg p-2 text-xs font-medium shadow-card ${cls}`}>
              {name}
            </div>
          ))}
        </div>
      </Section>

      {/* KPI cards */}
      <Section title="KPI cards">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Occupancy" value="82%" delta="6% WoW" trend="up" icon={<BedDouble />}>
            <Sparkline data={CHART} />
          </KpiCard>
          <KpiCard label="Arrivals / Departures" value="14 / 9" delta="3 pending" trend="flat" icon={<CalendarCheck />} hint="check-in" />
          <KpiCard label="Revenue today" value="₹2.41L" delta="₹38k unpaid" trend="up" goodDirection="up" icon={<IndianRupee />} />
          <KpiCard label="In-house guests" value="63" delta="2% WoW" trend="down" goodDirection="up" icon={<Users />} />
        </div>
      </Section>

      {/* Buttons */}
      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Primary</Button>
          <Button variant="brand">Brand</Button>
          <Button variant="success">Success</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
          <Button size="icon" aria-label="Add"><Plus /></Button>
          <Button disabled>Disabled</Button>
          <Button size="sm" onClick={() => toast.success("Booking confirmed", { description: "WMG-0007 · Rohit Sharma" })}>
            <Sparkles /> Toast
          </Button>
        </div>
      </Section>

      {/* Badges + status */}
      <Section title="Badges &amp; status pills">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="success">Paid</Badge>
          <Badge variant="warning">Pending</Badge>
          <Badge variant="destructive">Overdue</Badge>
          <Badge variant="brass">VIP</Badge>
          <Badge variant="outline">Outline</Badge>
          <Separator orientation="vertical" className="mx-1 h-5" />
          {STATUSES.map((s) => (
            <StatusPill key={s} status={s} />
          ))}
        </div>
      </Section>

      {/* Form controls */}
      <Section title="Form controls">
        <Card>
          <CardContent className="grid gap-4 pt-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="d-name">Guest name</Label>
              <Input id="d-name" placeholder="Rohit Sharma" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-cat">Room category</Label>
              <Select>
                <SelectTrigger id="d-cat"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="deluxe">Deluxe · ₹4,500</SelectItem>
                  <SelectItem value="premium">Premium · ₹6,000</SelectItem>
                  <SelectItem value="suite">Suite · ₹9,000</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="d-notes">Notes</Label>
              <Textarea id="d-notes" placeholder="Special requests, ETA…" />
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm"><Checkbox defaultChecked /> Aadhaar verified</label>
              <label className="flex items-center gap-2 text-sm"><Switch defaultChecked /> Send WhatsApp</label>
            </div>
          </CardContent>
        </Card>
      </Section>

      {/* Tabs + table */}
      <Section title="Tabs &amp; table">
        <Tabs defaultValue="arrivals">
          <TabsList>
            <TabsTrigger value="arrivals">Arrivals</TabsTrigger>
            <TabsTrigger value="inhouse">In-house</TabsTrigger>
            <TabsTrigger value="departures">Departures</TabsTrigger>
          </TabsList>
          <TabsContent value="arrivals">
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Guest</TableHead>
                    <TableHead>Room</TableHead>
                    <TableHead>ETA</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Rohit Sharma <Badge variant="brass" className="ml-1">VIP</Badge></TableCell>
                    <TableCell className="font-mono tabular">DLX-204</TableCell>
                    <TableCell className="font-mono tabular">14:00</TableCell>
                    <TableCell><Badge variant="secondary">Confirmed</Badge></TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Ananya Iyer</TableCell>
                    <TableCell className="font-mono tabular">STE-301</TableCell>
                    <TableCell className="font-mono tabular">18:30</TableCell>
                    <TableCell><Badge variant="success">Web · paid</Badge></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Card>
          </TabsContent>
          <TabsContent value="inhouse"><EmptyStateDemo /></TabsContent>
          <TabsContent value="departures"><EmptyStateDemo /></TabsContent>
        </Tabs>
      </Section>

      {/* Overlays */}
      <Section title="Overlays &amp; menus">
        <div className="flex flex-wrap items-center gap-2">
          <Dialog>
            <DialogTrigger asChild><Button variant="outline">Open dialog</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Void invoice INV/WMG/0007?</DialogTitle>
                <DialogDescription>This creates an audited credit note. This action cannot be undone.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                <Button variant="destructive"><Trash2 /> Void invoice</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild><Button variant="outline">Open sheet</Button></SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Guest profile</SheetTitle>
                <SheetDescription>Rohit Sharma · +91 98•• ••1234</SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                <p>12 stays · 34 room-nights · ₹4.2L lifetime</p>
                <p>Preferences: high floor, non-smoking</p>
              </div>
            </SheetContent>
          </Sheet>

          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline">Actions</Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Reservation</DropdownMenuLabel>
              <DropdownMenuItem><CalendarCheck /> Check in</DropdownMenuItem>
              <DropdownMenuItem><BedDouble /> Change room</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive"><Trash2 /> Cancel</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Popover>
            <PopoverTrigger asChild><Button variant="outline">Popover</Button></PopoverTrigger>
            <PopoverContent>
              <p className="text-sm font-medium">Quick note</p>
              <p className="mt-1 text-sm text-muted-foreground">Anything typed here is saved to the folio.</p>
            </PopoverContent>
          </Popover>

          <Tooltip>
            <TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Info"><Sparkles /></Button></TooltipTrigger>
            <TooltipContent>AI-suggested room: 208 (just cleaned)</TooltipContent>
          </Tooltip>
        </div>
      </Section>

      {/* Loading + empty */}
      <Section title="Loading &amp; empty states">
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
            <Skeleton className="mt-4 h-24 w-full" />
          </Card>
          <EmptyStateDemo />
        </div>
      </Section>

      <div className="h-10" />

      <CommandDialog open={cmdOpen} onOpenChange={setCmdOpen}>
        <CommandInput placeholder="Search guests, bookings, rooms, invoices…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Quick actions">
            <CommandItem><Plus /> New booking</CommandItem>
            <CommandItem><CalendarCheck /> Walk-in check-in</CommandItem>
          </CommandGroup>
          <CommandGroup heading="Recent">
            <CommandItem><Users /> Rohit Sharma · DLX-204</CommandItem>
            <CommandItem><IndianRupee /> Invoice INV/WMG/0007</CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </TooltipProvider>
  );
}

function EmptyStateDemo() {
  return (
    <EmptyState
      icon={<BedDouble />}
      title="No departures today"
      description="When an in-house guest is due to check out, they'll appear here."
      action={<Button size="sm" variant="outline"><Plus /> New booking</Button>}
    />
  );
}
