import { getPool } from "@/lib/db";
import { recordClick } from "@/search/query";

/** Click-out: counts the click (no personal data) and redirects to the original listing. */
export async function GET(request: Request, { params }: RouteContext<"/go/[id]">) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return new Response("Not found", { status: 404 });

  const url = await recordClick(getPool(), Number(id));
  if (!url) return new Response("Not found", { status: 404 });

  const target = new URL(url, request.url);
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return new Response("Invalid listing URL", { status: 502 });
  }
  return Response.redirect(target, 302);
}
