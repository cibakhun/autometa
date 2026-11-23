import { getPool } from "@/lib/db";
import { currentDevice, isCrossSite, seeOther } from "@/lib/profile";
import { deleteSearch, renameSearch, setSearchNotify } from "@/profiles/searches";

/** Forms on the list of saved searches: rename, pushes on/off, delete. */
export async function POST(request: Request, { params }: RouteContext<"/api/suchauftraege/[id]">) {
  if (isCrossSite(request)) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  const device = await currentDevice();
  if (!/^\d{1,18}$/.test(id) || !device) return seeOther("/suchauftraege");

  const form = await request.formData();
  const pool = getPool();
  const searchId = Number(id);
  switch (form.get("action")) {
    case "rename":
      await renameSearch(pool, device.profileId, searchId, String(form.get("name") ?? ""));
      break;
    case "notify":
      await setSearchNotify(pool, device.profileId, searchId, form.get("notify") === "1");
      break;
    case "delete":
      await deleteSearch(pool, device.profileId, searchId);
      return seeOther("/suchauftraege?geloescht=1");
  }
  return seeOther(`/suchauftraege#suche-${searchId}`);
}
