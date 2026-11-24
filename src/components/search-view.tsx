import { getPool } from "@/lib/db";
import { getFlipSettings } from "@/lib/flip-settings";
import { formatDayTime, formatNumber } from "@/lib/format";
import { currentDevice } from "@/lib/profile";
import { favoriteIds } from "@/profiles/favorites";
import { findSavedSearch, normalizeSearchQuery } from "@/profiles/searches";
import { filtersToQuery, MAX_PAGE, PAGE_SIZE, parseFilters, SORT_LABELS, type SearchFilters } from "@/search/filters";
import { parseNaturalSearch } from "@/search/natural";
import { findTown, getMakeFacets, getSourceFacets, resolveZip, searchListings, type Origin, type SearchResult } from "@/search/query";
import { FilterForm } from "./filter-form";
import { NaturalSearchBox } from "./natural-search";
import { ResultCard } from "./result-card";
import { SaveSearchButton } from "./save-search-button";
import { PendingResults, SearchLink, SearchTransition } from "./search-transition";

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
    // A failed town lookup only costs the explanation, never the results.
    filters.ki ? parseNaturalSearch(filters.ki, (name) => findTown(pool, name)).catch(() => null) : null,
  ]);
  const favorites = await favoriteIds(
    pool,
    device?.profileId ?? null,
    result.items.map((item) => item.id),
  );

  return (
    <SearchTransition>
      {/* Keyed by the sentence, so the field does not keep an old one after the filter form changed the search. */}
      <NaturalSearchBox key={filters.ki ?? ""} text={filters.ki} search={natural} sort={filters.sort} />
      <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
        <aside>
          <FilterForm key={filtersToQuery(filters, { page: 1 })} facets={facets} sources={sources} filters={filters} />
        </aside>
        <section aria-label="Suchergebnisse" className="min-w-0">
          <PendingResults>
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
                    <ResultCard
                      listing={item}
                      minMarginEur={settings.minMarginEur}
                      favorite={favorites.has(item.id)}
                      newSince={filters.seit}
                      allDrops={filters.gesenkt !== undefined || filters.sort === "price_drop"}
                    />
                  </li>
                ))}
              </ul>
            )}
            <Pagination result={result} filters={filters} />
          </PendingResults>
        </section>
      </div>
    </SearchTransition>
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
      <SearchLink href={`/${filtersToQuery(filters, { seit: undefined, page: 1 })}`} className="font-medium underline">
        Alle Treffer dieser Suche
      </SearchLink>
    </p>
  );
}

const pageButton = "inline-flex h-10 min-w-10 items-center justify-center rounded-md px-3";

/**
 * Previous/next and a few page numbers. The URL takes at most MAX_PAGE pages (anything beyond
 * falls back to page 1), so the last page offered is MAX_PAGE even when more vehicles match.
 */
function Pagination({ result, filters }: { result: SearchResult; filters: SearchFilters }) {
  const last = Math.min(result.pageCount, MAX_PAGE);
  if (last <= 1 || result.page > last) return null;
  const page = result.page;
  const pages = [...new Set([1, page - 1, page, page + 1, last])].filter((p) => p >= 1 && p <= last).sort((a, b) => a - b);
  const href = (p: number) => `/${filtersToQuery(filters, { page: p })}`;
  const capped = result.pageCount > MAX_PAGE;

  return (
    <nav aria-label="Seiten" className="mt-8 text-sm">
      <div className="flex items-center justify-between gap-2 sm:justify-center">
        {page > 1 ? (
          <SearchLink href={href(page - 1)} rel="prev" className={`${pageButton} gap-1 border border-line bg-surface font-medium hover:border-accent`}>
            <span aria-hidden="true">‹</span> Zurück
          </SearchLink>
        ) : (
          <span aria-disabled="true" className={`${pageButton} gap-1 border border-line text-muted opacity-50`}>
            <span aria-hidden="true">‹</span> Zurück
          </span>
        )}
        {/* Phones: just "Seite 3 von 400" between the two buttons. */}
        <span className="text-muted sm:hidden">
          Seite {formatNumber(page)} von {formatNumber(last)}
        </span>
        <ol className="hidden items-center gap-1 sm:flex">
          {pages.map((p, i) => (
            <li key={p} className="flex items-center gap-1">
              {i > 0 && p - pages[i - 1] > 1 && (
                <span aria-hidden="true" className="px-1 text-muted">
                  …
                </span>
              )}
              {p === page ? (
                <span aria-current="page" className={`${pageButton} bg-accent font-medium text-on-accent`}>
                  {formatNumber(p)}
                </span>
              ) : (
                <SearchLink href={href(p)} aria-label={`Seite ${p}`} className={`${pageButton} border border-line bg-surface hover:border-accent`}>
                  {formatNumber(p)}
                </SearchLink>
              )}
            </li>
          ))}
        </ol>
        {page < last ? (
          <SearchLink href={href(page + 1)} rel="next" className={`${pageButton} gap-1 border border-line bg-surface font-medium hover:border-accent`}>
            Weiter <span aria-hidden="true">›</span>
          </SearchLink>
        ) : (
          <span aria-disabled="true" className={`${pageButton} gap-1 border border-line text-muted opacity-50`}>
            Weiter <span aria-hidden="true">›</span>
          </span>
        )}
      </div>
      {capped && (
        <p className="mt-3 text-center text-xs text-muted">
          Angezeigt werden die ersten {formatNumber(MAX_PAGE)} Seiten ({formatNumber(MAX_PAGE * PAGE_SIZE)} Fahrzeuge). Für den Rest grenze die Suche
          mit Filtern ein oder ändere die Sortierung.
        </p>
      )}
    </nav>
  );
}
