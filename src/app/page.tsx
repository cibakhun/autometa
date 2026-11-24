import { Suspense } from "react";
import { SearchView } from "@/components/search-view";

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<SearchSkeleton />}>
      <SearchView searchParams={searchParams} />
    </Suspense>
  );
}

/** The shape of the search page while the first results load: same boxes, so nothing jumps. */
function SearchSkeleton() {
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        Suche lädt …
      </p>
      <div className="mb-6 h-36 animate-pulse rounded-xl bg-surface sm:h-28" />
      <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
        {/* Phones: the folded filter button; wider: the filter sidebar. */}
        <div className="h-11 animate-pulse rounded-md bg-surface md:h-[32rem] md:rounded-xl" />
        <div className="min-w-0">
          <div className="mb-4 space-y-3">
            <div className="h-7 w-40 animate-pulse rounded-md bg-surface" />
            <div className="h-9 w-64 max-w-full animate-pulse rounded-md bg-surface" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="overflow-hidden rounded-xl border border-line bg-surface">
                <div className="aspect-[4/3] animate-pulse bg-background" />
                <div className="space-y-2 p-4">
                  <div className="h-5 w-3/4 animate-pulse rounded bg-background" />
                  <div className="h-4 w-full animate-pulse rounded bg-background" />
                  <div className="h-4 w-1/2 animate-pulse rounded bg-background" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
