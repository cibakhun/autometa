import { getPool } from "@/lib/db";
import { currentDevice, isCrossSite, seeOther } from "@/lib/profile";
import { removeDevice } from "@/profiles/store";

/** Removes another device from the profile; it keeps nothing and gets no more pushes. */
export async function POST(request: Request, { params }: RouteContext<"/api/profil/geraete/[id]">) {
  if (isCrossSite(request)) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  const device = await currentDevice();
  if (device && /^\d{1,18}$/.test(id)) await removeDevice(getPool(), device, Number(id));
  return seeOther("/geraete");
}
