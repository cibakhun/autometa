import { connection } from "next/server";
import { listSamples } from "@/ingest/samples";
import { getRecentRuns, getSourceHealth } from "@/ingest/status";
import { ADMIN_HEADERS, adminToken, isAdminRequest, notFound } from "@/lib/admin";
import { renderStatusPage } from "@/lib/admin-pages";
import { getPool } from "@/lib/db";

/** GET /admin/quellen?token=...: how each source is doing, test fetches and stored pages. */
export async function GET(request: Request) {
  // Always at request time: the token is read from the environment of the running app.
  await connection();
  const token = adminToken();
  if (!token || !isAdminRequest(request, token)) return notFound();
  const pool = getPool();
  const [sources, runs, samples] = await Promise.all([getSourceHealth(pool), getRecentRuns(pool), listSamples(pool)]);
  return new Response(renderStatusPage({ token, sources, runs, samples }), {
    headers: { ...ADMIN_HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}
