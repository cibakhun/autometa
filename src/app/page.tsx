import { Suspense } from "react";
import { SearchView } from "@/components/search-view";

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<SearchSkeleton />}>
      <SearchView searchParams={searchParams} />
    </Suspense>
  );
}

function SearchSkeleton() {
  return (
    <div aria-busy="true">
      <div className="mb-6 h-28 animate-pulse rounded-xl bg-surface" />
      <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
        <div className="h-[32rem] animate-pulse rounded-xl bg-surface" />
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-xl bg-surface" />
          ))}
        </div>
      </div>
    </div>
  );
}
