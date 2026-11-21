import { cookies } from "next/headers";
import { FLIP_COOKIE, flipListHref, parseFlipCookie } from "@/lib/flip-settings";

/** /flip: the search for flip candidates with the visitor's level and minimum margin. */
export async function GET() {
  const settings = parseFlipCookie((await cookies()).get(FLIP_COOKIE)?.value);
  // A relative Location, because behind the proxy request.url carries the internal host.
  return new Response(null, { status: 307, headers: { Location: flipListHref(settings) } });
}
