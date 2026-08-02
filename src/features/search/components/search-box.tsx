"use client";

/**
 * 15 T-9 — global search box. URL-driven (`?q=`) like the guest box, so a search
 * is shareable/back-friendly and the server does the indexed fan-out + masking.
 */
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

export function SearchBox({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialQuery);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onChange = (next: string) => {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (next.trim()) params.set("q", next.trim());
      else params.delete("q");
      router.replace(`${pathname}?${params.toString()}`);
    }, 250);
  };

  return (
    <Input
      type="search"
      inputMode="search"
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search guests, bookings, invoices, expenses, staff…"
      aria-label="Search anything"
      data-testid="global-search-input"
    />
  );
}
