import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { search } from "@/features/search/queries";
import { SearchBox } from "@/features/search/components/search-box";
import { ResultCards } from "@/features/search/components/result-cards";
import { ExportMenu } from "@/features/search/components/export-menu";

export const metadata: Metadata = { title: "Search" };

/** 15 T-9/T-10 — unified search across every entity the user may see (FR-1/2/3). */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const canExport = hasPermission(user, "export:data");

  const page = query ? await search(user, { keyword: query, limit: 25 }) : { results: [], nextCursor: {} };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Search</h1>
      <SearchBox initialQuery={query} />
      {canExport && query && page.results.length > 0 && <ExportMenu keyword={query} />}
      <ResultCards results={page.results} query={query} />
    </div>
  );
}
