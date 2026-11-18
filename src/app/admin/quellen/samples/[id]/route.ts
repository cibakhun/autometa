import { connection } from "next/server";
import { getSample, sliceBody } from "@/ingest/samples";
import { ADMIN_HEADERS, adminToken, isAdminRequest, notFound } from "@/lib/admin";
import { getPool } from "@/lib/db";

/**
 * GET /admin/quellen/samples/<id>?token=...: a stored page as plain text, never rendered.
 * &grep=<pattern>[&context=300] shows the passages around the matches, &from=&len= a slice.
 */
export async function GET(request: Request, { params }: RouteContext<"/admin/quellen/samples/[id]">) {
  // Always at request time: the token is read from the environment of the running app.
  await connection();
  const token = adminToken();
  if (!token || !isAdminRequest(request, token)) return notFound();
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return notFound();
  const sample = await getSample(getPool(), Number(id));
  if (!sample) return notFound();

  const search = new URL(request.url).searchParams;
  const number = (name: string) => (search.has(name) ? Number(search.get(name)) : undefined);
  const text = sliceBody(sample.body, {
    grep: search.get("grep") ?? undefined,
    context: number("context"),
    maxMatches: number("max"),
    from: number("from"),
    length: number("len"),
  });
  const header = `#${sample.id} ${sample.url}\nHTTP ${sample.status}, ${sample.reason}${sample.sourceId ? ` (${sample.sourceId})` : ""}, ${sample.capturedAt}, ${sample.length} Zeichen${sample.truncated ? " (gekürzt)" : ""}\n\n`;
  return new Response(header + text, {
    headers: {
      ...ADMIN_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
