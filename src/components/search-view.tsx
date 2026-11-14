import Link from "next/link";
import { getPool } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { filtersToQuery, parseFilters, SORT_LABELS, type SearchFilters } from "@/search/filters";
import { getMakeFacets, resolveZip, searchListings, type Origin, type SearchResult } from "@/search/query";
import { FilterForm } from "./filter-form";
import { ResultCard } from "./result-card";

export async function SearchView({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const filters = parseFilters(await searchParams);
  const pool = getPool();
  const origin = filters.zip ? await resolveZip(pool, filters.zip) : null;
  const [facets, result] = await Promise.all([getMakeFacets(pool), searchListings(pool, filters, origin)]);

  return (
    <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
      <aside>
        <FilterForm key={filtersToQuery(filters, { page: 1 })} facets={facets} filters={filters} />
      </aside>
      <section aria-label="Suchergebnisse" className="min-w-0">
        <ResultHeader result={result} filters={filters} origin={origin} />
        {result.items.length === 0 ? (
          <div className="rounded-xl border border-line bg-surface p-8 text-center">
            <p className="font-medium">Keine Fahrzeuge gefunden.</p>
            <p className="mt-1 text-sm text-muted">Lockere einen Filter oder vergrößere den Umkreis.</p>
          </div>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {result.items.map((item) => (
              <li key={item.id}>
                <ResultCard listing={item} />
              </li>
            ))}
          </ul>
        )}
        <Pagination result={result} filters={filters} />
      </section>
    </div>
  );
}

function ResultHeader({ result, filters, origin }: { result: SearchResult; filters: SearchFilters; origin: Origin | null }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
      <h1 className="text-lg font-semibold">
        {formatNumber(result.total)} {result.total === 1 ? "Fahrzeug" : "Fahrzeuge"}
      </h1>
      <p className="text-sm text-muted">
        {SORT_LABELS[filters.sort]}
        {filters.zip && origin && (
          <>
            {" · "}
            {filters.radius} km um {origin.exact ? `${origin.zip} ${origin.city}` : `${filters.zip} (ungefähr, Bezugsort ${origin.city})`}
          </>
        )}
        {filters.zip && !origin && <> · PLZ {filters.zip} unbekannt, Umkreis ignoriert</>}
      </p>
    </div>
  );
}

function Pagination({ result, filters }: { result: SearchResult; filters: SearchFilters }) {
  if (result.pageCount <= 1) return null;
  const page = result.page;
  const pages = [...new Set([1, page - 1, page, page + 1, result.pageCount])]
    .filter((p) => p >= 1 && p <= result.pageCount)
    .sort((a, b) => a - b);

  return (
    <nav aria-label="Seiten" className="mt-6 flex flex-wrap items-center justify-center gap-1 text-sm">
      {pages.map((p, i) => (
        <span key={p} className="flex items-center gap-1">
          {i > 0 && p - pages[i - 1] > 1 && <span className="px-1 text-muted">…</span>}
          {p === page ? (
            <span aria-current="page" className="rounded-md bg-accent px-3 py-1.5 font-medium text-white">
              {p}
            </span>
          ) : (
            <Link href={`/${filtersToQuery(filters, { page: p })}`} className="rounded-md border border-line bg-surface px-3 py-1.5 hover:border-accent">
              {p}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
