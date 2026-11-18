import { connection } from "next/server";
import { probe } from "@/ingest/probe";
import { ADMIN_HEADERS, adminToken, isAdminRequest, notFound } from "@/lib/admin";
import { renderProbeResult } from "@/lib/admin-pages";
import { getPool } from "@/lib/db";

/**
 * GET /admin/quellen/probe?token=...&url=...&scripts=1: fetches one portal page from the server
 * (robots.txt and pacing apply) and stores it for reading on /admin/quellen.
 */
export async function GET(request: Request) {
  // Always at request time: the token is read from the environment of the running app.
  await connection();
  const token = adminToken();
  if (!token || !isAdminRequest(request, token)) return notFound();
  const params = new URL(request.url).searchParams;
  const url = params.get("url")?.trim() ?? "";
  const outcomes = await probe(getPool(), url, { scripts: params.get("scripts") === "1" });
  return new Response(renderProbeResult({ token, url, outcomes }), {
    headers: { ...ADMIN_HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}
