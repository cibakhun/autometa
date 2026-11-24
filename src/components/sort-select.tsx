"use client";

import { filtersToQuery, SORT_LABELS, SORTS, type SearchFilters, type Sort } from "@/search/filters";
import { Spinner, useSearchNavigation } from "./search-transition";

/**
 * The sort order right above the results, so it can be changed without opening the filter form
 * (on a phone that sits folded away above the list). Sorting by distance needs a postal code.
 */
export function SortSelect({ filters }: { filters: SearchFilters }) {
  const { navigate, pendingOrigin } = useSearchNavigation();
  const sorts = SORTS.filter((sort) => sort !== "distance" || filters.zip);
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2">
      <label htmlFor="sort-top" className="text-sm text-muted">
        Sortierung
      </label>
      <select
        id="sort-top"
        defaultValue={filters.sort}
        onChange={(event) => navigate(`/${filtersToQuery(filters, { sort: event.target.value as Sort, page: 1 })}`, "sort")}
        className="min-w-0 max-w-full rounded-md border border-line bg-surface py-1.5 pl-2 pr-1 text-base font-medium outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 sm:text-sm"
      >
        {sorts.map((sort) => (
          <option key={sort} value={sort}>
            {SORT_LABELS[sort]}
          </option>
        ))}
      </select>
      {pendingOrigin === "sort" && <Spinner className="h-4 w-4 text-muted" />}
    </span>
  );
}
