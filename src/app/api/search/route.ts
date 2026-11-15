import { getPool } from "@/lib/db";
import { parseFilters } from "@/search/filters";
import { resolveZip, searchListings } from "@/search/query";

/** GET /api/search?make=volkswagen&priceMax=15000&zip=10115&radius=50 -> JSON results. */
export async function GET(request: Request) {
  const filters = parseFilters(new URL(request.url).searchParams);
  const pool = getPool();
  const origin = filters.zip ? await resolveZip(pool, filters.zip) : null;
  const result = await searchListings(pool, filters, origin);
  return Response.json({ filters, origin, ...result });
}
