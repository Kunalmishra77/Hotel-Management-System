"use client";

/**
 * Guest search box — 04 T-18 (FR-8/10, AC-7/AC-10).
 *
 * A debounced, URL-driven search: typing updates `?q=`, the server component
 * re-runs `searchGuests` and streams masked results. Keeping the query in the
 * URL makes a search shareable and back-button-friendly, and keeps the heavy
 * lifting (decrypt+mask, trigram index) on the server where the data lives.
 */
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

export function GuestSearchBox({ initialQuery }: { initialQuery: string }) {
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
      placeholder="Search by name, mobile, email, company or GSTIN"
      aria-label="Search guests"
      data-testid="guest-search-input"
    />
  );
}
