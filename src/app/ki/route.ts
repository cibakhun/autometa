import { getPool } from "@/lib/db";
import { filtersToQuery, parseFilters } from "@/search/filters";
import { MAX_TEXT_LENGTH, naturalSearchParams, parseNaturalSearch } from "@/search/natural";
import { findTown } from "@/search/query";

/**
 * /ki?text=…: a search in own words ("zuverlässiger Kombi für Familie bis 8.000 €"), turned into
 * the search page's filters; the text goes along as "ki", so the page can show how it was read.
 */
export async function GET(request: Request) {
  const text = (new URL(request.url).searchParams.get("text") ?? "").trim().slice(0, MAX_TEXT_LENGTH);
  let target = "/";
  if (text) {
    const pool = getPool();
    const search = await parseNaturalSearch(text, (name) => findTown(pool, name));
    target = `/${filtersToQuery(parseFilters(naturalSearchParams(search, text)))}`;
  }
  // A relative Location, because behind the proxy request.url carries the internal host.
  return new Response(null, { status: 303, headers: { Location: target } });
}
