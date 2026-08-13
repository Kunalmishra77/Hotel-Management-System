"use client";

/**
 * ⌘K command palette — jump to any page, or search guests & bookings live, from
 * anywhere. A trigger button sits in the header; ⌘K / Ctrl+K opens it globally.
 * Navigation is filtered client-side; guests/bookings come from the scoped server
 * action (permission-honouring). `shouldFilter={false}` — we control the list.
 */
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, CalendarDays, User, CornerDownLeft } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { NavIcon } from "./nav-icon";
import { commandSearch, type CommandResults } from "../search-action";

type NavLite = { key: string; label: string; href: string; icon: string };

const STATUS_LABEL: Record<string, string> = {
  ENQUIRY: "Enquiry", CONFIRMED: "Confirmed", IN_HOUSE: "In-house",
  CHECKED_OUT: "Checked out", CANCELLED: "Cancelled", NO_SHOW: "No-show",
};

export function CommandPalette({ navItems }: { navItems: NavLite[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CommandResults>({ guests: [], bookings: [] });
  const [pending, startTransition] = useTransition();

  // Global ⌘K / Ctrl+K toggles the palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Debounced live search for guests + bookings.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults({ guests: [], bookings: [] }); return; }
    const t = setTimeout(() => {
      startTransition(async () => setResults(await commandSearch(q)));
    }, 180);
    return () => clearTimeout(t);
  }, [query]);

  const navMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = q ? navItems.filter((n) => n.label.toLowerCase().includes(q)) : navItems;
    return items.slice(0, 8);
  }, [query, navItems]);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-touch items-center gap-2 rounded-md border px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Search (Ctrl+K)"
      >
        <Search className="size-4" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="ml-1 hidden rounded bg-muted px-1.5 text-xs font-medium sm:inline">Ctrl K</kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-hidden p-0">
          <DialogTitle className="sr-only">Command palette</DialogTitle>
          <Command shouldFilter={false} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
            <CommandInput
              placeholder="Search guests, bookings, or jump to a page…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>{pending ? "Searching…" : "No results."}</CommandEmpty>

              {results.guests.length > 0 && (
                <CommandGroup heading="Guests">
                  {results.guests.map((g) => (
                    <CommandItem key={g.id} value={`g-${g.id}`} onSelect={() => go(`/guests/${g.id}`)}>
                      <User className="text-muted-foreground" />
                      <span className="truncate">{g.name}</span>
                      {g.sub ? <span className="ml-auto truncate text-xs text-muted-foreground">{g.sub}</span> : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {results.bookings.length > 0 && (
                <CommandGroup heading="Bookings">
                  {results.bookings.map((b) => (
                    <CommandItem key={b.id} value={`b-${b.id}`} onSelect={() => go(`/bookings/${b.id}`)}>
                      <CalendarDays className="text-muted-foreground" />
                      <span className="truncate"><span className="font-mono text-xs">{b.code}</span> · {b.guestName}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{STATUS_LABEL[b.status] ?? b.status}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {navMatches.length > 0 && (
                <CommandGroup heading="Jump to">
                  {navMatches.map((n) => (
                    <CommandItem key={n.key} value={`nav-${n.key}`} onSelect={() => go(n.href)}>
                      <NavIcon name={n.icon} className="size-4 text-muted-foreground" />
                      <span>{n.label}</span>
                      <CornerDownLeft className="ml-auto size-3.5 text-muted-foreground/40" />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
