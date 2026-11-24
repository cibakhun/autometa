import { connection } from "next/server";
import { getPool } from "@/lib/db";
import { getFlipSettings } from "@/lib/flip-settings";
import { formatDayTime, formatNumber } from "@/lib/format";
import { currentDevice } from "@/lib/profile";
import { favoriteIds } from "@/profiles/favorites";
import { findSavedSearch, normalizeSearchQuery } from "@/profiles/searches";
import { filtersToQuery, MAX_PAGE, PAGE_SIZE, parseFilters, RADII_KM, type SearchFilters } from "@/search/filters";
import { parseNaturalSearch } from "@/search/natural";
import { findTown, getMakeFacets, getSourceFacets, resolveZip, searchListings, type Origin, type SearchResult } from "@/search/query";
import { activeFilters, type ActiveFilter } from "./active-filters";
import { FilterForm } from "./filter-form";
import { NaturalSearchBox } from "./natural-search";
import { ResultCard } from "./result-card";
import { SaveSearchButton } from "./save-search-button";
import { PendingResults, SearchLink, SearchTransition } from "./search-transition";
import { SortSelect } from "./sort-select";

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
    // A failed town lookup only costs the explanation, never the results. The parser reads the
    // current date, which Cache Components only allows at request time, hence connection().
    filters.ki
      ? connection()
          .then(() => parseNaturalSearch(filters.ki!, (name) => findTown(pool, name)))
          .catch(() => null)
      : null,
  ]);
  const favorites = await favoriteIds(
    pool,
    device?.profileId ?? null,
    result.items.map((item) => item.id),
  );
  const chips = activeFilters(filters, { makes: facets, sources });

  return (
    <SearchTransition>
      {/* Keyed by the sentence, so the field does not keep an old one after the filter form changed the search. */}
      <NaturalSearchBox key={filters.ki ?? ""} text={filters.ki} search={natural} sort={filters.sort} />
      <div className="grid gap-4 md:grid-cols-[18rem_1fr] md:gap-6">
        <aside>
          <FilterForm key={filtersToQuery(filters, { page: 1 })} facets={facets} sources={sources} filters={filters} />
        </aside>
        <section aria-label="Suchergebnisse" className="min-w-0">
          <PendingResults>
            <ResultHeader result={result} filters={filters} origin={origin} savedQuery={savedQuery} saved={saved} chips={chips} />
            {filters.seit && result.items.length > 0 && <NewSinceNotice filters={filters} />}
            {result.items.length === 0 ? (
              <EmptyState result={result} filters={filters} origin={origin} chips={chips} />
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
  chips,
}: {
  result: SearchResult;
  filters: SearchFilters;
  origin: Origin | null;
  savedQuery: string;
  saved: { id: number; name: string } | null;
  chips: ActiveFilter[];
}) {
  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-lg font-semibold">
          {formatNumber(result.total)} {result.total === 1 ? "Fahrzeug" : "Fahrzeuge"}
          {filters.seit && <span className="font-normal text-muted"> neu oder günstiger</span>}
        </h1>
        <SaveSearchButton key={savedQuery} query={savedQuery} saved={saved} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
        <SortSelect key={filtersToQuery(filters)} filters={filters} />
        {filters.zip && origin && (
          <span>
            {filters.radius}&nbsp;km um {origin.exact ? `${origin.zip} ${origin.city}` : `${filters.zip} (ungefähr, Bezugsort ${origin.city})`}
          </span>
        )}
        {filters.zip && !origin && <span>PLZ {filters.zip} unbekannt, Umkreis ignoriert</span>}
      </div>
      {/* With no results the chips move into the empty state, as the way out. */}
      {result.items.length > 0 && chips.length > 0 && <FilterChips filters={filters} chips={chips} />}
    </div>
  );
}

/** The search without any filter, in the same sort order (distance needs the postal code it loses). */
const resetHref = (filters: SearchFilters) => `/${filtersToQuery(parseFilters({}), { sort: filters.sort === "distance" ? "newest" : filters.sort })}`;

/** The active filters as chips; tapping one removes it. */
function FilterChips({ filters, chips, center = false }: { filters: SearchFilters; chips: ActiveFilter[]; center?: boolean }) {
  return (
    <ul aria-label="Aktive Filter" className={`flex flex-wrap items-center gap-1.5 ${center ? "justify-center" : ""}`}>
      {chips.map((chip) => (
        <li key={chip.key}>
          <SearchLink
            href={chip.href}
            aria-label={`Filter „${chip.label}“ entfernen`}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-surface py-1 pl-3 pr-2 text-xs font-medium hover:border-accent hover:text-accent"
          >
            {chip.label}
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-muted" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </SearchLink>
        </li>
      ))}
      {chips.length > 1 && (
        <li>
          <SearchLink href={resetHref(filters)} className="inline-flex min-h-8 items-center px-2 text-xs font-medium text-accent hover:underline">
            Alle entfernen
          </SearchLink>
        </li>
      )}
    </ul>
  );
}

const actionButton =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium hover:border-accent";

/** No vehicle on this page: a page past the end, nothing new since …, or filters that rule out everything. */
function EmptyState({ result, filters, origin, chips }: { result: SearchResult; filters: SearchFilters; origin: Origin | null; chips: ActiveFilter[] }) {
  const box = "rounded-xl border border-line bg-surface px-4 py-8 text-center sm:px-8";
  if (result.total > 0) {
    return (
      <div className={box}>
        <p className="font-semibold">Diese Seite gibt es nicht (mehr)</p>
        <p className="mt-1 text-sm text-muted">
          Die Suche hat {formatNumber(result.total)} Treffer auf{" "}
          {formatNumber(Math.min(result.pageCount, MAX_PAGE))} {result.pageCount === 1 ? "Seite" : "Seiten"}.
        </p>
        <SearchLink href={`/${filtersToQuery(filters, { page: 1 })}`} className={`${actionButton} mt-4`}>
          Zur ersten Seite
        </SearchLink>
      </div>
    );
  }
  if (filters.seit) {
    return (
      <div className={box}>
        <p className="font-semibold">Nichts Neues</p>
        <p className="mt-1 text-sm text-muted">Seit {formatDayTime(filters.seit)} kam für diese Suche kein Fahrzeug dazu, und keins wurde günstiger.</p>
        <SearchLink href={`/${filtersToQuery(filters, { seit: undefined, page: 1 })}`} className={`${actionButton} mt-4`}>
          Alle Treffer dieser Suche
        </SearchLink>
      </div>
    );
  }
  const radius = filters.radius ?? 50;
  const wider = filters.zip && origin ? RADII_KM.find((r) => r > radius) : undefined;
  return (
    <div className={box}>
      <p className="font-semibold">Keine Fahrzeuge gefunden</p>
      {chips.length > 0 ? (
        <>
          <p className="mt-1 text-sm text-muted">
            {chips.length === 1 ? "Kein Angebot passt zu diesem Filter. Ein Klick entfernt ihn:" : "Kein Angebot passt zu allen Filtern. Lockere einen davon, ein Klick entfernt ihn:"}
          </p>
          <div className="mt-4">
            <FilterChips filters={filters} chips={chips} center />
          </div>
          {wider && (
            <SearchLink href={`/${filtersToQuery(filters, { radius: wider, ki: undefined, page: 1 })}`} className={`${actionButton} mt-4`}>
              Umkreis auf {wider}&nbsp;km vergrößern
            </SearchLink>
          )}
          {filters.q && (
            <p className="mt-4 text-xs text-muted">
              Der Suchbegriff „{filters.q}“ muss im Anzeigentitel stehen. Prüf die Schreibweise oder versuch ein kürzeres Wort.
            </p>
          )}
        </>
      ) : (
        <p className="mt-1 text-sm text-muted">Gerade ist kein Angebot in der Datenbank. Schau später noch einmal vorbei.</p>
      )}
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
