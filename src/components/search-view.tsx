import Link from "next/link";
import { getPool } from "@/lib/db";
import { getFlipSettings } from "@/lib/flip-settings";
import { formatDayTime, formatNumber } from "@/lib/format";
import { currentDevice } from "@/lib/profile";
import { favoriteIds } from "@/profiles/favorites";
import { findSavedSearch, normalizeSearchQuery } from "@/profiles/searches";
import { filtersToQuery, parseFilters, SORT_LABELS, type SearchFilters } from "@/search/filters";
import { parseNaturalSearch } from "@/search/natural";
import { findTown, getMakeFacets, getSourceFacets, resolveZip, searchListings, type Origin, type SearchResult } from "@/search/query";
import { FilterForm } from "./filter-form";
import { NaturalSearchBox } from "./natural-search";
import { ResultCard } from "./result-card";
import { SaveSearchButton } from "./save-search-button";

export async function SearchView({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const [filters, settings, device] = await Promise.all([searchParams.then(parseFilters), getFlipSettings(), currentDevice()]);
  const pool = getPool();
  const origin = filters.zip ? await resolveZip(pool, filters.zip) : null;
  const savedQuery = normalizeSearchQuery(filtersToQuery(filters));
  const [facets, sources, result, saved, natural] = await Promise.all([
    getMakeFacets(pool),
    getSourceFacets(pool),
    searchListings(pool, filters, origin, settings),
    findSavedSearch(pool, device?.profileId ?? null, savedQuery),
    // Read the sentence again to show how it was understood; the filters themselves come from the URL.
    filters.ki ? parseNaturalSearch(filters.ki, (name) => findTown(pool, name)) : null,
  ]);
  const favorites = await favoriteIds(
    pool,
    device?.profileId ?? null,
    result.items.map((item) => item.id),
  );

  return (
    <>
      <NaturalSearchBox text={filters.ki} search={natural} sort={filters.sort} />
      <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
        <aside>
          <FilterForm key={filtersToQuery(filters, { page: 1 })} facets={facets} sources={sources} filters={filters} />
        </aside>
        <section aria-label="Suchergebnisse" className="min-w-0">
          <ResultHeader result={result} filters={filters} origin={origin} savedQuery={savedQuery} saved={saved} />
          {filters.seit && <NewSinceNotice filters={filters} />}
          {result.items.length === 0 ? (
            <div className="rounded-xl border border-line bg-surface p-8 text-center">
              <p className="font-medium">Keine Fahrzeuge gefunden.</p>
              <p className="mt-1 text-sm text-muted">Lockere einen Filter oder vergrößere den Umkreis.</p>
            </div>
          ) : (
            <ul className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {result.items.map((item) => (
                <li key={item.id}>
                  <ResultCard listing={item} minMarginEur={settings.minMarginEur} favorite={favorites.has(item.id)} newSince={filters.seit} />
                </li>
              ))}
            </ul>
          )}
          <Pagination result={result} filters={filters} />
        </section>
      </div>
    </>
  );
}

function ResultHeader({
  result,
  filters,
  origin,
  savedQuery,
  saved,
}: {
  result: SearchResult;
  filters: SearchFilters;
  origin: Origin | null;
  savedQuery: string;
  saved: { id: number; name: string } | null;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <h1 className="text-lg font-semibold">
        {formatNumber(result.total)} {result.total === 1 ? "Fahrzeug" : "Fahrzeuge"}
        {filters.seit && <span className="font-normal text-muted"> neu oder günstiger</span>}
      </h1>
      <SaveSearchButton key={savedQuery} query={savedQuery} saved={saved} />
      <p className="w-full text-sm text-muted">
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

/** Above the results of "only new since …" (opened from a saved search or a push). */
function NewSinceNotice({ filters }: { filters: SearchFilters }) {
  return (
    <p className="mb-4 rounded-md border border-line bg-accent-soft px-3 py-2 text-sm text-accent-strong">
      Nur Fahrzeuge, die seit {formatDayTime(filters.seit!)} neu dazukamen oder günstiger wurden.{" "}
      <Link href={`/${filtersToQuery(filters, { seit: undefined, page: 1 })}`} className="font-medium underline">
        Alle Treffer dieser Suche
      </Link>
    </p>
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
            <span aria-current="page" className="rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent">
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
