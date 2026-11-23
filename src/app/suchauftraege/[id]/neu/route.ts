import { getPool } from "@/lib/db";
import { currentDevice } from "@/lib/profile";
import { openNewOfSearch } from "@/profiles/searches";

/**
 * Opens what a saved search found since it was last opened (link on the list and in pushes;
 * `ab` = since when the push counted) and marks it as seen.
 */
export async function GET(request: Request, { params }: RouteContext<"/suchauftraege/[id]/neu">) {
  const { id } = await params;
  const device = await currentDevice();
  const target =
    /^\d{1,18}$/.test(id) && device
      ? await openNewOfSearch(getPool(), device.profileId, Number(id), new URL(request.url).searchParams.get("ab"))
      : null;
  // A relative Location, because behind the proxy request.url carries the internal host.
  return new Response(null, { status: 307, headers: { Location: target ?? "/suchauftraege" } });
}
